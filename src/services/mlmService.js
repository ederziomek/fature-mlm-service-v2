const MLMModel = require('../models/mlmModel');
const ConfigClient = require('../utils/configClient');
const logger = require('../utils/logger');

class MLMService {
    constructor() {
        this.mlmModel = new MLMModel();
        this.configClient = new ConfigClient();
        
        // Cache para configurações
        this.configCache = new Map();
        
        // Subscrever a mudanças de configuração
        this.setupConfigSubscriptions();
    }

    setupConfigSubscriptions() {
        // Subscrever a mudanças nos valores CPA
        this.configClient.subscribe('cpa_level_amounts', (newValues) => {
            logger.info('Valores CPA atualizados:', newValues);
            this.configCache.set('cpa_level_amounts', newValues);
        });

        // Subscrever a mudanças nas configurações MLM
        this.configClient.subscribe('mlm_settings', (newSettings) => {
            logger.info('Configurações MLM atualizadas:', newSettings);
            this.configCache.set('mlm_settings', newSettings);
        });

        // Subscrever a mudanças nas regras de validação CPA
        this.configClient.subscribe('cpa_validation_rules', (newRules) => {
            logger.info('Regras de validação CPA atualizadas:', newRules);
            this.configCache.set('cpa_validation_rules', newRules);
        });
    }

    // Buscar configurações com cache
    async getConfig(key, defaultValue = null) {
        if (this.configCache.has(key)) {
            return this.configCache.get(key);
        }

        const value = await this.configClient.getConfig(key, defaultValue);
        this.configCache.set(key, value);
        return value;
    }

    // Processar CPA para distribuição MLM
    async processCpaForDistribution(userId, affiliateId, cpaData) {
        const startTime = Date.now();
        
        try {
            logger.info(`Processando CPA para distribuição: user=${userId}, affiliate=${affiliateId}`);

            // Buscar configurações dinâmicas
            const cpaAmounts = await this.getConfig('cpa_level_amounts');
            const mlmSettings = await this.getConfig('mlm_settings');
            const validationRules = await this.getConfig('cpa_validation_rules');

            // Validar CPA
            const isValid = await this.validateCpa(userId, cpaData, validationRules);
            if (!isValid) {
                throw new Error('CPA não atende aos critérios de validação');
            }

            // Buscar upline do afiliado
            const upline = await this.mlmModel.getAffiliateUpline(affiliateId, mlmSettings.max_hierarchy_levels);
            
            // Calcular distribuições
            const distributions = this.calculateDistributions(upline, cpaAmounts, mlmSettings);

            // Salvar CPA validado
            const cpaValidado = await this.mlmModel.saveCpaValidado({
                user_id: userId,
                affiliate_id: affiliateId,
                affiliate_level: 1, // Nível do afiliado que gerou o CPA
                cpa_amount: cpaData.amount,
                validation_rule_id: cpaData.ruleId || 'default',
                validation_criteria: cpaData.criteria || {}
            });

            // Executar distribuições
            const distributionResults = [];
            for (const distribution of distributions) {
                const result = await this.executeCpaDistribution(cpaValidado.id, distribution);
                distributionResults.push(result);
            }

            // Atualizar estatísticas
            await this.updateStatistics(distributions);

            const executionTime = Date.now() - startTime;
            
            // Log da operação
            await this.mlmModel.logOperation(
                'CPA_DISTRIBUTION',
                'CPA',
                cpaValidado.id,
                { userId, affiliateId, cpaData },
                { distributions: distributionResults },
                'SUCCESS',
                null,
                executionTime
            );

            logger.info(`CPA processado com sucesso em ${executionTime}ms`);

            return {
                cpaValidado,
                distributions: distributionResults,
                totalDistributed: distributionResults.reduce((sum, d) => sum + d.distributed_amount, 0)
            };

        } catch (error) {
            const executionTime = Date.now() - startTime;
            
            await this.mlmModel.logOperation(
                'CPA_DISTRIBUTION',
                'CPA',
                `${userId}_${affiliateId}`,
                { userId, affiliateId, cpaData },
                null,
                'ERROR',
                error.message,
                executionTime
            );

            logger.error('Erro ao processar CPA:', error);
            throw error;
        }
    }

    // Validar CPA baseado nas regras dinâmicas
    async validateCpa(userId, cpaData, validationRules) {
        try {
            if (!validationRules || !validationRules.groups || validationRules.groups.length === 0) {
                logger.warn('Nenhuma regra de validação configurada, aprovando CPA');
                return true;
            }

            const groupResults = [];

            for (const group of validationRules.groups) {
                const criteriaResults = [];

                for (const criteria of group.criteria) {
                    if (!criteria.enabled) continue;

                    let result = false;

                    switch (criteria.type) {
                        case 'deposit':
                            result = cpaData.depositAmount >= criteria.value;
                            break;
                        case 'bets':
                            result = cpaData.betsCount >= criteria.value;
                            break;
                        case 'bet_amount':
                            result = cpaData.totalBetAmount >= criteria.value;
                            break;
                        case 'days_active':
                            result = cpaData.daysActive >= criteria.value;
                            break;
                        default:
                            logger.warn(`Tipo de critério desconhecido: ${criteria.type}`);
                            result = false;
                    }

                    criteriaResults.push(result);
                }

                // Aplicar operador do grupo (AND/OR)
                let groupResult;
                if (group.operator === 'AND') {
                    groupResult = criteriaResults.every(r => r);
                } else { // OR
                    groupResult = criteriaResults.some(r => r);
                }

                groupResults.push(groupResult);
            }

            // Aplicar operador entre grupos
            let finalResult;
            if (validationRules.group_operator === 'AND') {
                finalResult = groupResults.every(r => r);
            } else { // OR
                finalResult = groupResults.some(r => r);
            }

            logger.info(`Validação CPA: ${finalResult ? 'APROVADO' : 'REJEITADO'}`, {
                userId,
                groupResults,
                finalResult
            });

            return finalResult;

        } catch (error) {
            logger.error('Erro na validação CPA:', error);
            return false;
        }
    }

    // Calcular distribuições MLM
    calculateDistributions(upline, cpaAmounts, mlmSettings) {
        const distributions = [];

        for (const affiliate of upline) {
            const levelKey = `level_${affiliate.upline_level}`;
            const amount = cpaAmounts[levelKey];

            if (amount && amount > 0 && affiliate.upline_level <= mlmSettings.max_hierarchy_levels) {
                distributions.push({
                    affiliate_id: affiliate.affiliate_id,
                    affiliate_level: affiliate.upline_level,
                    amount: amount,
                    currency: mlmSettings.currency || 'BRL'
                });
            }
        }

        return distributions;
    }

    // Executar distribuição CPA
    async executeCpaDistribution(cpaValidadoId, distribution) {
        try {
            // Verificar valor mínimo
            const mlmSettings = await this.getConfig('mlm_settings');
            if (distribution.amount < mlmSettings.minimum_amount) {
                logger.warn(`Valor abaixo do mínimo: ${distribution.amount} < ${mlmSettings.minimum_amount}`);
                return null;
            }

            // Gerar ID de transação
            const transactionId = `CPA_${cpaValidadoId}_${distribution.affiliate_id}_${Date.now()}`;

            // Salvar distribuição
            const distributionRecord = await this.mlmModel.saveCpaDistribution({
                cpa_validado_id: cpaValidadoId,
                user_id: null, // Será preenchido pelo contexto
                affiliate_id: distribution.affiliate_id,
                affiliate_level: distribution.affiliate_level,
                original_amount: distribution.amount,
                distributed_amount: distribution.amount,
                transaction_id: transactionId
            });

            // Aqui seria feita a integração com o sistema de pagamento
            // Por enquanto, apenas simulamos o sucesso
            logger.info(`Distribuição CPA executada: ${transactionId} - R$ ${distribution.amount}`);

            return distributionRecord;

        } catch (error) {
            logger.error('Erro ao executar distribuição CPA:', error);
            throw error;
        }
    }

    // Atualizar estatísticas MLM
    async updateStatistics(distributions) {
        try {
            const today = new Date();
            const periodStart = new Date(today.getFullYear(), today.getMonth(), 1);
            const periodEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);

            // Agrupar distribuições por afiliado
            const affiliateStats = new Map();

            for (const distribution of distributions) {
                const affiliateId = distribution.affiliate_id;
                
                if (!affiliateStats.has(affiliateId)) {
                    affiliateStats.set(affiliateId, {
                        total_cpas: 0,
                        total_amount: 0,
                        level_1_cpas: 0, level_1_amount: 0,
                        level_2_cpas: 0, level_2_amount: 0,
                        level_3_cpas: 0, level_3_amount: 0,
                        level_4_cpas: 0, level_4_amount: 0,
                        level_5_cpas: 0, level_5_amount: 0
                    });
                }

                const stats = affiliateStats.get(affiliateId);
                stats.total_cpas += 1;
                stats.total_amount += distribution.amount;

                const levelKey = `level_${distribution.affiliate_level}`;
                stats[`${levelKey}_cpas`] += 1;
                stats[`${levelKey}_amount`] += distribution.amount;
            }

            // Atualizar estatísticas no banco
            for (const [affiliateId, stats] of affiliateStats) {
                await this.mlmModel.updateAffiliateStatistics(
                    affiliateId,
                    periodStart,
                    periodEnd,
                    stats
                );
            }

        } catch (error) {
            logger.error('Erro ao atualizar estatísticas:', error);
            // Não propagar erro para não quebrar o fluxo principal
        }
    }

    // Buscar hierarquia de um afiliado
    async getAffiliateHierarchy(affiliateId, maxLevels = null) {
        try {
            const mlmSettings = await this.getConfig('mlm_settings');
            const levels = maxLevels || mlmSettings.max_hierarchy_levels;
            
            return await this.mlmModel.getAffiliateHierarchy(affiliateId, levels);
        } catch (error) {
            logger.error('Erro ao buscar hierarquia:', error);
            throw error;
        }
    }

    // Buscar upline de um afiliado
    async getAffiliateUpline(affiliateId, maxLevels = null) {
        try {
            const mlmSettings = await this.getConfig('mlm_settings');
            const levels = maxLevels || mlmSettings.max_hierarchy_levels;
            
            return await this.mlmModel.getAffiliateUpline(affiliateId, levels);
        } catch (error) {
            logger.error('Erro ao buscar upline:', error);
            throw error;
        }
    }

    // Criar ou atualizar afiliado
    async upsertAffiliate(affiliateId, parentId = null) {
        try {
            return await this.mlmModel.upsertAffiliate(affiliateId, parentId);
        } catch (error) {
            logger.error('Erro ao criar/atualizar afiliado:', error);
            throw error;
        }
    }

    // Buscar CPAs de um afiliado
    async getAffiliateCpas(affiliateId, filters = {}) {
        try {
            return await this.mlmModel.getAffiliateCpas(affiliateId, filters);
        } catch (error) {
            logger.error('Erro ao buscar CPAs:', error);
            throw error;
        }
    }

    // Buscar estatísticas de um afiliado
    async getAffiliateStatistics(affiliateId, periodStart = null, periodEnd = null) {
        try {
            if (!periodStart || !periodEnd) {
                const today = new Date();
                periodStart = new Date(today.getFullYear(), today.getMonth(), 1);
                periodEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
            }

            return await this.mlmModel.getAffiliateStatistics(affiliateId, periodStart, periodEnd);
        } catch (error) {
            logger.error('Erro ao buscar estatísticas:', error);
            throw error;
        }
    }

    // Health check
    async healthCheck() {
        try {
            // Verificar conexão com banco
            await this.mlmModel.pool.query('SELECT 1');
            
            // Verificar conexão com Config Service
            await this.configClient.healthCheck();

            return {
                status: 'healthy',
                timestamp: new Date().toISOString(),
                services: {
                    database: 'connected',
                    configService: 'connected'
                }
            };
        } catch (error) {
            logger.error('Health check falhou:', error);
            return {
                status: 'unhealthy',
                timestamp: new Date().toISOString(),
                error: error.message
            };
        }
    }

    async close() {
        if (this.configClient) {
            this.configClient.close();
        }
        if (this.mlmModel) {
            await this.mlmModel.close();
        }
    }
}

module.exports = MLMService;

