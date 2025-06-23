const MLMService = require('../services/mlmService');
const logger = require('../utils/logger');

class MLMController {
    constructor() {
        this.mlmService = new MLMService();
    }

    // Health check
    async healthCheck(req, res) {
        try {
            const health = await this.mlmService.healthCheck();
            res.status(health.status === 'healthy' ? 200 : 503).json({
                success: health.status === 'healthy',
                data: health
            });
        } catch (error) {
            logger.error('Erro no health check:', error);
            res.status(503).json({
                success: false,
                message: 'Serviço indisponível',
                error: error.message
            });
        }
    }

    // Processar CPA para distribuição MLM
    async processCpa(req, res) {
        try {
            const { userId, affiliateId, cpaData } = req.body;

            if (!userId || !affiliateId || !cpaData) {
                return res.status(400).json({
                    success: false,
                    message: 'userId, affiliateId e cpaData são obrigatórios'
                });
            }

            const result = await this.mlmService.processCpaForDistribution(userId, affiliateId, cpaData);

            res.status(200).json({
                success: true,
                message: 'CPA processado com sucesso',
                data: result
            });

        } catch (error) {
            logger.error('Erro ao processar CPA:', error);
            res.status(500).json({
                success: false,
                message: 'Erro ao processar CPA',
                error: error.message
            });
        }
    }

    // Buscar hierarquia de um afiliado
    async getHierarchy(req, res) {
        try {
            const { affiliateId } = req.params;
            const { maxLevels } = req.query;

            if (!affiliateId) {
                return res.status(400).json({
                    success: false,
                    message: 'affiliateId é obrigatório'
                });
            }

            const hierarchy = await this.mlmService.getAffiliateHierarchy(
                parseInt(affiliateId),
                maxLevels ? parseInt(maxLevels) : null
            );

            res.status(200).json({
                success: true,
                data: {
                    affiliateId: parseInt(affiliateId),
                    hierarchy,
                    totalLevels: hierarchy.length
                }
            });

        } catch (error) {
            logger.error('Erro ao buscar hierarquia:', error);
            res.status(500).json({
                success: false,
                message: 'Erro ao buscar hierarquia',
                error: error.message
            });
        }
    }

    // Buscar upline de um afiliado
    async getUpline(req, res) {
        try {
            const { affiliateId } = req.params;
            const { maxLevels } = req.query;

            if (!affiliateId) {
                return res.status(400).json({
                    success: false,
                    message: 'affiliateId é obrigatório'
                });
            }

            const upline = await this.mlmService.getAffiliateUpline(
                parseInt(affiliateId),
                maxLevels ? parseInt(maxLevels) : null
            );

            res.status(200).json({
                success: true,
                data: {
                    affiliateId: parseInt(affiliateId),
                    upline,
                    totalLevels: upline.length
                }
            });

        } catch (error) {
            logger.error('Erro ao buscar upline:', error);
            res.status(500).json({
                success: false,
                message: 'Erro ao buscar upline',
                error: error.message
            });
        }
    }

    // Criar ou atualizar afiliado
    async upsertAffiliate(req, res) {
        try {
            const { affiliateId, parentId } = req.body;

            if (!affiliateId) {
                return res.status(400).json({
                    success: false,
                    message: 'affiliateId é obrigatório'
                });
            }

            const affiliate = await this.mlmService.upsertAffiliate(
                parseInt(affiliateId),
                parentId ? parseInt(parentId) : null
            );

            res.status(200).json({
                success: true,
                message: 'Afiliado criado/atualizado com sucesso',
                data: affiliate
            });

        } catch (error) {
            logger.error('Erro ao criar/atualizar afiliado:', error);
            res.status(500).json({
                success: false,
                message: 'Erro ao criar/atualizar afiliado',
                error: error.message
            });
        }
    }

    // Buscar CPAs de um afiliado
    async getAffiliateCpas(req, res) {
        try {
            const { affiliateId } = req.params;
            const { status, level, dateFrom, dateTo, limit } = req.query;

            if (!affiliateId) {
                return res.status(400).json({
                    success: false,
                    message: 'affiliateId é obrigatório'
                });
            }

            const filters = {};
            if (status) filters.status = status;
            if (level) filters.level = parseInt(level);
            if (dateFrom) filters.dateFrom = new Date(dateFrom);
            if (dateTo) filters.dateTo = new Date(dateTo);
            if (limit) filters.limit = parseInt(limit);

            const cpas = await this.mlmService.getAffiliateCpas(parseInt(affiliateId), filters);

            res.status(200).json({
                success: true,
                data: {
                    affiliateId: parseInt(affiliateId),
                    cpas,
                    totalCpas: cpas.length,
                    filters
                }
            });

        } catch (error) {
            logger.error('Erro ao buscar CPAs:', error);
            res.status(500).json({
                success: false,
                message: 'Erro ao buscar CPAs',
                error: error.message
            });
        }
    }

    // Buscar estatísticas de um afiliado
    async getAffiliateStatistics(req, res) {
        try {
            const { affiliateId } = req.params;
            const { periodStart, periodEnd } = req.query;

            if (!affiliateId) {
                return res.status(400).json({
                    success: false,
                    message: 'affiliateId é obrigatório'
                });
            }

            const statistics = await this.mlmService.getAffiliateStatistics(
                parseInt(affiliateId),
                periodStart ? new Date(periodStart) : null,
                periodEnd ? new Date(periodEnd) : null
            );

            res.status(200).json({
                success: true,
                data: {
                    affiliateId: parseInt(affiliateId),
                    statistics: statistics || {
                        message: 'Nenhuma estatística encontrada para o período'
                    }
                }
            });

        } catch (error) {
            logger.error('Erro ao buscar estatísticas:', error);
            res.status(500).json({
                success: false,
                message: 'Erro ao buscar estatísticas',
                error: error.message
            });
        }
    }

    // Buscar configurações CPA atuais
    async getCpaConfig(req, res) {
        try {
            const cpaAmounts = await this.mlmService.getConfig('cpa_level_amounts');
            const validationRules = await this.mlmService.getConfig('cpa_validation_rules');
            const mlmSettings = await this.mlmService.getConfig('mlm_settings');

            res.status(200).json({
                success: true,
                data: {
                    cpaAmounts,
                    validationRules,
                    mlmSettings,
                    timestamp: new Date().toISOString()
                }
            });

        } catch (error) {
            logger.error('Erro ao buscar configurações CPA:', error);
            res.status(500).json({
                success: false,
                message: 'Erro ao buscar configurações CPA',
                error: error.message
            });
        }
    }

    // Simular distribuição CPA (para testes)
    async simulateCpaDistribution(req, res) {
        try {
            const { affiliateId, cpaAmount } = req.body;

            if (!affiliateId || !cpaAmount) {
                return res.status(400).json({
                    success: false,
                    message: 'affiliateId e cpaAmount são obrigatórios'
                });
            }

            // Buscar upline
            const upline = await this.mlmService.getAffiliateUpline(parseInt(affiliateId));
            
            // Buscar valores CPA
            const cpaAmounts = await this.mlmService.getConfig('cpa_level_amounts');
            const mlmSettings = await this.mlmService.getConfig('mlm_settings');

            // Calcular distribuições
            const distributions = this.mlmService.calculateDistributions(upline, cpaAmounts, mlmSettings);

            const totalDistribution = distributions.reduce((sum, d) => sum + d.amount, 0);

            res.status(200).json({
                success: true,
                message: 'Simulação de distribuição CPA',
                data: {
                    affiliateId: parseInt(affiliateId),
                    originalAmount: parseFloat(cpaAmount),
                    upline,
                    distributions,
                    totalDistribution,
                    remainingAmount: parseFloat(cpaAmount) - totalDistribution
                }
            });

        } catch (error) {
            logger.error('Erro na simulação:', error);
            res.status(500).json({
                success: false,
                message: 'Erro na simulação',
                error: error.message
            });
        }
    }

    // Buscar resumo geral do MLM
    async getMlmSummary(req, res) {
        try {
            const { period } = req.query;
            
            // Por enquanto, retornar dados básicos
            // Em uma implementação completa, isso seria calculado do banco
            
            res.status(200).json({
                success: true,
                data: {
                    period: period || 'current_month',
                    summary: {
                        totalAffiliates: 0,
                        totalCpas: 0,
                        totalDistributed: 0,
                        averagePerAffiliate: 0
                    },
                    message: 'Funcionalidade em desenvolvimento'
                }
            });

        } catch (error) {
            logger.error('Erro ao buscar resumo MLM:', error);
            res.status(500).json({
                success: false,
                message: 'Erro ao buscar resumo MLM',
                error: error.message
            });
        }
    }
}

module.exports = MLMController;

