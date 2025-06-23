const cron = require('node-cron');
const MLMService = require('../services/mlmService');
const logger = require('../utils/logger');

class CpaProcessingJob {
    constructor() {
        this.mlmService = new MLMService();
        this.isRunning = false;
        this.cronJob = null;
    }

    // Iniciar job automático
    start() {
        if (process.env.ENABLE_CRON_JOBS !== 'true') {
            logger.info('Jobs automáticos desabilitados via configuração');
            return;
        }

        const cronExpression = process.env.CPA_DISTRIBUTION_CRON || '*/5 * * * *'; // A cada 5 minutos por padrão
        
        this.cronJob = cron.schedule(cronExpression, async () => {
            if (this.isRunning) {
                logger.warn('Job de processamento CPA já está executando, pulando...');
                return;
            }

            await this.processPendingCpas();
        }, {
            scheduled: false,
            timezone: 'America/Sao_Paulo'
        });

        this.cronJob.start();
        logger.info(`Job de processamento CPA iniciado com cron: ${cronExpression}`);
    }

    // Parar job
    stop() {
        if (this.cronJob) {
            this.cronJob.stop();
            logger.info('Job de processamento CPA parado');
        }
    }

    // Processar CPAs pendentes
    async processPendingCpas() {
        this.isRunning = true;
        const startTime = Date.now();
        
        try {
            logger.info('Iniciando processamento de CPAs pendentes...');

            // Buscar configurações dinâmicas
            const systemSettings = await this.mlmService.getConfig('system_settings');
            const batchSize = systemSettings.batch_size || 100;

            // Aqui seria feita a integração com o banco da operação
            // Por enquanto, vamos simular a busca de CPAs pendentes
            const pendingCpas = await this.fetchPendingCpasFromOperationDB(batchSize);

            if (pendingCpas.length === 0) {
                logger.info('Nenhum CPA pendente encontrado');
                return;
            }

            logger.info(`Processando ${pendingCpas.length} CPAs pendentes`);

            let processed = 0;
            let errors = 0;

            for (const cpa of pendingCpas) {
                try {
                    await this.processSingleCpa(cpa);
                    processed++;
                } catch (error) {
                    logger.error(`Erro ao processar CPA ${cpa.id}:`, error);
                    errors++;
                }
            }

            const executionTime = Date.now() - startTime;
            logger.info(`Processamento concluído: ${processed} processados, ${errors} erros em ${executionTime}ms`);

        } catch (error) {
            logger.error('Erro no job de processamento CPA:', error);
        } finally {
            this.isRunning = false;
        }
    }

    // Buscar CPAs pendentes do banco da operação
    async fetchPendingCpasFromOperationDB(limit = 100) {
        try {
            // Aqui seria feita a conexão com o banco da operação
            // Por enquanto, retornamos array vazio para não quebrar
            
            // Exemplo de como seria:
            /*
            const { Pool } = require('pg');
            const externalPool = new Pool({
                host: process.env.EXTERNAL_DB_HOST,
                port: process.env.EXTERNAL_DB_PORT,
                database: process.env.EXTERNAL_DB_NAME,
                user: process.env.EXTERNAL_DB_USER,
                password: process.env.EXTERNAL_DB_PASSWORD,
                ssl: process.env.EXTERNAL_DB_SSL === 'true'
            });

            const query = `
                SELECT 
                    u.id as user_id,
                    u.affiliate_id,
                    u.deposit_amount,
                    u.bets_count,
                    u.total_bet_amount,
                    u.days_active,
                    u.created_at
                FROM users u
                WHERE u.cpa_processed = false
                AND u.affiliate_id IS NOT NULL
                AND u.deposit_amount >= 30
                ORDER BY u.created_at ASC
                LIMIT $1
            `;

            const result = await externalPool.query(query, [limit]);
            return result.rows;
            */

            return []; // Por enquanto, retorna vazio

        } catch (error) {
            logger.error('Erro ao buscar CPAs pendentes:', error);
            return [];
        }
    }

    // Processar um CPA individual
    async processSingleCpa(cpa) {
        try {
            const cpaData = {
                amount: 50.00, // Valor base do CPA - poderia vir da configuração
                depositAmount: cpa.deposit_amount,
                betsCount: cpa.bets_count,
                totalBetAmount: cpa.total_bet_amount,
                daysActive: cpa.days_active,
                ruleId: 'auto_processing',
                criteria: {
                    source: 'automatic_job',
                    processed_at: new Date().toISOString()
                }
            };

            const result = await this.mlmService.processCpaForDistribution(
                cpa.user_id,
                cpa.affiliate_id,
                cpaData
            );

            logger.info(`CPA processado com sucesso: user=${cpa.user_id}, affiliate=${cpa.affiliate_id}, distributed=${result.totalDistributed}`);

            // Marcar como processado no banco da operação
            await this.markCpaAsProcessed(cpa.user_id);

            return result;

        } catch (error) {
            logger.error(`Erro ao processar CPA individual:`, error);
            throw error;
        }
    }

    // Marcar CPA como processado no banco da operação
    async markCpaAsProcessed(userId) {
        try {
            // Aqui seria feita a atualização no banco da operação
            // Por enquanto, apenas logamos
            
            logger.info(`CPA marcado como processado: user=${userId}`);

            // Exemplo de como seria:
            /*
            const query = `
                UPDATE users 
                SET cpa_processed = true, cpa_processed_at = CURRENT_TIMESTAMP
                WHERE id = $1
            `;
            await externalPool.query(query, [userId]);
            */

        } catch (error) {
            logger.error('Erro ao marcar CPA como processado:', error);
            // Não propagar erro para não quebrar o processamento
        }
    }

    // Executar processamento manual
    async runManual() {
        if (this.isRunning) {
            throw new Error('Job já está executando');
        }

        logger.info('Executando processamento manual de CPAs...');
        await this.processPendingCpas();
    }

    // Obter status do job
    getStatus() {
        return {
            isRunning: this.isRunning,
            cronExpression: process.env.CPA_DISTRIBUTION_CRON || '*/5 * * * *',
            enabled: process.env.ENABLE_CRON_JOBS === 'true',
            nextRun: this.cronJob ? this.cronJob.nextDate() : null
        };
    }
}

module.exports = CpaProcessingJob;

