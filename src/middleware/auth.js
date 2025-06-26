const logger = require('../utils/logger');

// Middleware de autenticação opcional
const optionalAuth = (req, res, next) => {
    const apiKey = req.headers['x-api-key'] || req.headers['authorization'];
    
    // Se não há API key, continua sem autenticação (para health checks)
    if (!apiKey) {
        req.authenticated = false;
        return next();
    }
    
    // Verificar API Key
    const validApiKey = process.env.MLM_API_KEY;
    if (apiKey === validApiKey || apiKey === `Bearer ${validApiKey}`) {
        req.authenticated = true;
        req.user = {
            username: 'api_user',
            role: 'admin'
        };
    } else {
        req.authenticated = false;
    }
    
    next();
};

// Middleware de autenticação obrigatória
const requireAuth = (req, res, next) => {
    const apiKey = req.headers['x-api-key'] || req.headers['authorization'];
    
    if (!apiKey) {
        return res.status(401).json({
            success: false,
            message: 'API Key obrigatória'
        });
    }
    
    const validApiKey = process.env.MLM_API_KEY;
    if (apiKey !== validApiKey && apiKey !== `Bearer ${validApiKey}`) {
        return res.status(401).json({
            success: false,
            message: 'API Key inválida'
        });
    }
    
    req.user = {
        username: 'api_user',
        role: 'admin'
    };
    
    next();
};

module.exports = {
    optionalAuth,
    requireAuth
};
