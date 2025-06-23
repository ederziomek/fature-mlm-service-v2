require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');

const mlmRoutes = require('./routes/mlmRoutes');
const { requestLogger, errorHandler, corsHandler } = require('./middleware/validation');
const logger = require('./utils/logger');

class MLMServiceApp {
    constructor() {
        this.app = express();
        this.port = process.env.PORT || 3002;
        this.host = process.env.HOST || '0.0.0.0';
        
        this.setupMiddleware();
        this.setupRoutes();
        this.setupErrorHandling();
    }

    setupMiddleware() {
        // Segurança
        this.app.use(helmet({
            crossOriginResourcePolicy: { policy: "cross-origin" }
        }));

        // CORS
        this.app.use(cors({
            origin: '*',
            credentials: true,
            methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
            allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization', 'X-API-Key']
        }));

        // Compressão
        this.app.use(compression());

        // Parsing
        this.app.use(express.json({ limit: '10mb' }));
        this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

        // Logging
        if (process.env.NODE_ENV !== 'test') {
            this.app.use(morgan('combined', {
                stream: {
                    write: (message) => logger.info(message.trim())
                }
            }));
        }

        this.app.use(requestLogger);

        // Headers customizados
        this.app.use((req, res, next) => {
            res.header('X-Service', 'fature-mlm-service-v2');
            res.header('X-Version', process.env.npm_package_version || '2.0.0');
            next();
        });
    }

    setupRoutes() {
        // Rota raiz
        this.app.get('/', (req, res) => {
            res.json({
                service: 'Fature MLM Service V2',
                version: process.env.npm_package_version || '2.0.0',
                status: 'running',
                timestamp: new Date().toISOString(),
                description: 'Serviço MLM migrado para Node.js com configurações 100% dinâmicas',
                endpoints: {
                    health: '/api/v1/health',
                    cpa: '/api/v1/cpa/*',
                    affiliate: '/api/v1/affiliate/*',
                    summary: '/api/v1/summary',
                    docs: '/api/v1/docs'
                }
            });
        });

        // Rotas da API
        this.app.use('/api/v1', mlmRoutes);

        // Documentação básica da API
        this.app.get('/api/v1/docs', (req, res) => {
            res.json({
                title: 'Fature MLM Service V2 API',
                version: '2.0.0',
                description: 'API para gerenciamento de hierarquia MLM e distribuição CPA',
                baseUrl: `${req.protocol}://${req.get('host')}/api/v1`,
                endpoints: {
                    'GET /health': 'Health check do serviço',
                    'POST /cpa/process': 'Processar CPA para distribuição MLM',
                    'POST /cpa/simulate': 'Simular distribuição CPA',
                    'GET /cpa/config': 'Buscar configurações CPA atuais',
                    'GET /affiliate/:id/hierarchy': 'Buscar hierarquia de um afiliado',
                    'GET /affiliate/:id/upline': 'Buscar upline de um afiliado',
                    'POST /affiliate': 'Criar afiliado na hierarquia',
                    'PUT /affiliate': 'Atualizar afiliado na hierarquia',
                    'GET /affiliate/:id/cpas': 'Buscar CPAs de um afiliado',
                    'GET /affiliate/:id/statistics': 'Buscar estatísticas de um afiliado',
                    'GET /summary': 'Resumo geral do MLM'
                },
                authentication: {
                    type: 'API Key',
                    header: 'X-API-Key ou Authorization',
                    description: 'Incluir API Key no header da requisição'
                },
                features: {
                    'Zero Hardcoded Values': 'Todas as configurações vêm do Config Service',
                    'Real-time Updates': 'Configurações atualizadas automaticamente',
                    'MLM Hierarchy': 'Gestão completa de hierarquia MLM',
                    'CPA Distribution': 'Distribuição automática baseada em regras',
                    'Statistics': 'Estatísticas detalhadas por afiliado',
                    'Validation': 'Validação de CPA baseada em critérios dinâmicos'
                }
            });
        });

        // Rota 404
        this.app.use('*', (req, res) => {
            res.status(404).json({
                success: false,
                message: 'Endpoint não encontrado',
                path: req.originalUrl,
                method: req.method
            });
        });
    }

    setupErrorHandling() {
        this.app.use(errorHandler);

        // Handlers de processo
        process.on('uncaughtException', (error) => {
            logger.error('Uncaught Exception:', error);
            this.gracefulShutdown('uncaughtException');
        });

        process.on('unhandledRejection', (reason, promise) => {
            logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
            this.gracefulShutdown('unhandledRejection');
        });

        process.on('SIGTERM', () => {
            logger.info('SIGTERM recebido');
            this.gracefulShutdown('SIGTERM');
        });

        process.on('SIGINT', () => {
            logger.info('SIGINT recebido');
            this.gracefulShutdown('SIGINT');
        });
    }

    async start() {
        try {
            // Testar conexão com banco antes de iniciar
            const { createTables } = require('./database/migrate');
            await createTables();
            
            this.server = this.app.listen(this.port, this.host, () => {
                logger.info(`🚀 MLM Service V2 iniciado em http://${this.host}:${this.port}`);
                logger.info(`📚 Documentação disponível em http://${this.host}:${this.port}/api/v1/docs`);
                logger.info(`🏥 Health check disponível em http://${this.host}:${this.port}/api/v1/health`);
                logger.info(`🔧 Configurações dinâmicas via Config Service`);
            });

        } catch (error) {
            logger.error('Erro ao iniciar o serviço:', error);
            process.exit(1);
        }
    }

    async gracefulShutdown(signal) {
        logger.info(`Iniciando shutdown graceful devido a: ${signal}`);

        // Fechar servidor HTTP
        if (this.server) {
            this.server.close(() => {
                logger.info('Servidor HTTP fechado');
            });
        }

        // Aguardar um tempo para conexões ativas terminarem
        setTimeout(() => {
            logger.info('Shutdown completo');
            process.exit(0);
        }, 5000);
    }

    // Método para obter estatísticas do serviço
    getStats() {
        return {
            service: 'fature-mlm-service-v2',
            version: process.env.npm_package_version || '2.0.0',
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            timestamp: new Date().toISOString()
        };
    }
}

// Iniciar aplicação se executado diretamente
if (require.main === module) {
    const app = new MLMServiceApp();
    app.start();
}

module.exports = MLMServiceApp;

