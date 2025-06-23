const Joi = require('joi');
const logger = require('../utils/logger');

// Middleware de validação genérico
const validate = (schema) => {
    return (req, res, next) => {
        const { error, value } = schema.validate(req.body);
        
        if (error) {
            const errors = error.details.map(detail => ({
                field: detail.path.join('.'),
                message: detail.message
            }));
            
            return res.status(400).json({
                success: false,
                message: 'Dados de entrada inválidos',
                errors
            });
        }
        
        req.body = value;
        next();
    };
};

// Schemas de validação
const schemas = {
    processCpa: Joi.object({
        userId: Joi.number().integer().positive().required(),
        affiliateId: Joi.number().integer().positive().required(),
        cpaData: Joi.object({
            amount: Joi.number().positive().required(),
            depositAmount: Joi.number().positive().optional(),
            betsCount: Joi.number().integer().min(0).optional(),
            totalBetAmount: Joi.number().positive().optional(),
            daysActive: Joi.number().integer().min(0).optional(),
            ruleId: Joi.string().optional(),
            criteria: Joi.object().optional()
        }).required()
    }),

    upsertAffiliate: Joi.object({
        affiliateId: Joi.number().integer().positive().required(),
        parentId: Joi.number().integer().positive().optional().allow(null)
    }),

    simulateDistribution: Joi.object({
        affiliateId: Joi.number().integer().positive().required(),
        cpaAmount: Joi.number().positive().required()
    })
};

// Middleware de autenticação simples (API Key)
const authenticate = (req, res, next) => {
    const apiKey = req.headers['x-api-key'] || req.headers['authorization'];
    
    if (!apiKey) {
        return res.status(401).json({
            success: false,
            message: 'API Key obrigatória'
        });
    }

    // Verificar API Key
    const validApiKey = process.env.API_KEY_SECRET;
    if (apiKey !== validApiKey && apiKey !== `Bearer ${validApiKey}`) {
        return res.status(401).json({
            success: false,
            message: 'API Key inválida'
        });
    }

    // Adicionar usuário fictício para auditoria
    req.user = {
        username: 'api_user',
        role: 'admin'
    };

    next();
};

// Middleware de rate limiting
const rateLimit = require('express-rate-limit');

const createRateLimit = (windowMs, max, message) => {
    return rateLimit({
        windowMs,
        max,
        message: {
            success: false,
            message: message || 'Muitas requisições, tente novamente mais tarde'
        },
        standardHeaders: true,
        legacyHeaders: false,
    });
};

// Rate limits específicos
const rateLimits = {
    general: createRateLimit(
        parseInt(process.env.RATE_LIMIT_WINDOW) || 15 * 60 * 1000, // 15 minutos
        parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 200,
        'Limite de requisições excedido'
    ),
    
    write: createRateLimit(
        5 * 60 * 1000, // 5 minutos
        50, // 50 operações de escrita por 5 minutos
        'Limite de operações de escrita excedido'
    ),
    
    read: createRateLimit(
        1 * 60 * 1000, // 1 minuto
        500, // 500 operações de leitura por minuto
        'Limite de operações de leitura excedido'
    ),

    cpaProcessing: createRateLimit(
        1 * 60 * 1000, // 1 minuto
        10, // 10 processamentos CPA por minuto
        'Limite de processamento CPA excedido'
    )
};

// Middleware de logging de requisições
const requestLogger = (req, res, next) => {
    const start = Date.now();
    
    res.on('finish', () => {
        const duration = Date.now() - start;
        const logData = {
            method: req.method,
            url: req.url,
            status: res.statusCode,
            duration: `${duration}ms`,
            ip: req.ip,
            userAgent: req.get('User-Agent')
        };
        
        if (res.statusCode >= 400) {
            logger.warn('Request completed with error', logData);
        } else {
            logger.info('Request completed', logData);
        }
    });
    
    next();
};

// Middleware de tratamento de erros
const errorHandler = (err, req, res, next) => {
    logger.error('Erro não tratado:', {
        error: err.message,
        stack: err.stack,
        url: req.url,
        method: req.method,
        ip: req.ip
    });

    // Erro de validação do Joi
    if (err.isJoi) {
        return res.status(400).json({
            success: false,
            message: 'Dados de entrada inválidos',
            errors: err.details.map(detail => ({
                field: detail.path.join('.'),
                message: detail.message
            }))
        });
    }

    // Erro de banco de dados
    if (err.code === '23505') { // Unique constraint violation
        return res.status(409).json({
            success: false,
            message: 'Registro já existe'
        });
    }

    if (err.code === '23503') { // Foreign key constraint violation
        return res.status(400).json({
            success: false,
            message: 'Referência inválida'
        });
    }

    // Erro genérico
    res.status(500).json({
        success: false,
        message: 'Erro interno do servidor',
        error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
};

// Middleware de CORS customizado
const corsHandler = (req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-API-Key');
    res.header('Access-Control-Allow-Credentials', 'true');
    
    if (req.method === 'OPTIONS') {
        res.sendStatus(200);
    } else {
        next();
    }
};

// Middleware de validação de parâmetros
const validateParams = {
    affiliateId: (req, res, next) => {
        const { affiliateId } = req.params;
        
        if (!affiliateId || isNaN(parseInt(affiliateId)) || parseInt(affiliateId) <= 0) {
            return res.status(400).json({
                success: false,
                message: 'affiliateId deve ser um número inteiro positivo'
            });
        }
        
        req.params.affiliateId = parseInt(affiliateId);
        next();
    }
};

module.exports = {
    validate,
    schemas,
    authenticate,
    rateLimits,
    requestLogger,
    errorHandler,
    corsHandler,
    validateParams
};

