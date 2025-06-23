const { Pool } = require('pg');
const logger = require('../utils/logger');

class MLMModel {
    constructor() {
        this.pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
            min: parseInt(process.env.DB_POOL_MIN) || 2,
            max: parseInt(process.env.DB_POOL_MAX) || 10,
        });
    }

    // Buscar hierarquia de um afiliado
    async getAffiliateHierarchy(affiliateId, maxLevels = 5) {
        const client = await this.pool.connect();
        try {
            const query = `
                WITH RECURSIVE affiliate_tree AS (
                    -- Nó inicial
                    SELECT 
                        affiliate_id, 
                        parent_id, 
                        level,
                        path,
                        1 as depth
                    FROM mlm_hierarchy 
                    WHERE affiliate_id = $1 AND active = true
                    
                    UNION ALL
                    
                    -- Recursão para filhos
                    SELECT 
                        h.affiliate_id, 
                        h.parent_id, 
                        h.level,
                        h.path,
                        at.depth + 1
                    FROM mlm_hierarchy h
                    INNER JOIN affiliate_tree at ON h.parent_id = at.affiliate_id
                    WHERE at.depth < $2 AND h.active = true
                )
                SELECT * FROM affiliate_tree 
                ORDER BY depth, level, affiliate_id;
            `;
            
            const result = await client.query(query, [affiliateId, maxLevels]);
            return result.rows;
        } catch (error) {
            logger.error('Erro ao buscar hierarquia do afiliado:', error);
            throw error;
        } finally {
            client.release();
        }
    }

    // Buscar upline de um afiliado (níveis acima)
    async getAffiliateUpline(affiliateId, maxLevels = 5) {
        const client = await this.pool.connect();
        try {
            const query = `
                WITH RECURSIVE upline_tree AS (
                    -- Nó inicial
                    SELECT 
                        affiliate_id, 
                        parent_id, 
                        level,
                        path,
                        1 as upline_level
                    FROM mlm_hierarchy 
                    WHERE affiliate_id = $1 AND active = true
                    
                    UNION ALL
                    
                    -- Recursão para pais
                    SELECT 
                        h.affiliate_id, 
                        h.parent_id, 
                        h.level,
                        h.path,
                        ut.upline_level + 1
                    FROM mlm_hierarchy h
                    INNER JOIN upline_tree ut ON h.affiliate_id = ut.parent_id
                    WHERE ut.upline_level < $2 AND h.active = true
                )
                SELECT * FROM upline_tree 
                WHERE upline_level > 1
                ORDER BY upline_level;
            `;
            
            const result = await client.query(query, [affiliateId, maxLevels]);
            return result.rows;
        } catch (error) {
            logger.error('Erro ao buscar upline do afiliado:', error);
            throw error;
        } finally {
            client.release();
        }
    }

    // Criar ou atualizar afiliado na hierarquia
    async upsertAffiliate(affiliateId, parentId = null) {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');

            // Verificar se afiliado já existe
            const existingQuery = 'SELECT * FROM mlm_hierarchy WHERE affiliate_id = $1';
            const existingResult = await client.query(existingQuery, [affiliateId]);

            if (existingResult.rows.length > 0) {
                // Atualizar se necessário
                const existing = existingResult.rows[0];
                if (existing.parent_id !== parentId) {
                    await this.updateAffiliateParent(client, affiliateId, parentId);
                }
                await client.query('COMMIT');
                return existing;
            }

            // Calcular nível e path
            let level = 1;
            let path = [affiliateId];

            if (parentId) {
                const parentQuery = 'SELECT level, path FROM mlm_hierarchy WHERE affiliate_id = $1 AND active = true';
                const parentResult = await client.query(parentQuery, [parentId]);
                
                if (parentResult.rows.length > 0) {
                    const parent = parentResult.rows[0];
                    level = parent.level + 1;
                    path = [...parent.path, affiliateId];
                }
            }

            // Inserir novo afiliado
            const insertQuery = `
                INSERT INTO mlm_hierarchy (affiliate_id, parent_id, level, path)
                VALUES ($1, $2, $3, $4)
                RETURNING *
            `;
            
            const result = await client.query(insertQuery, [affiliateId, parentId, level, path]);
            
            await client.query('COMMIT');
            return result.rows[0];
        } catch (error) {
            await client.query('ROLLBACK');
            logger.error('Erro ao criar/atualizar afiliado:', error);
            throw error;
        } finally {
            client.release();
        }
    }

    // Atualizar parent de um afiliado
    async updateAffiliateParent(client, affiliateId, newParentId) {
        try {
            // Calcular novo nível e path
            let newLevel = 1;
            let newPath = [affiliateId];

            if (newParentId) {
                const parentQuery = 'SELECT level, path FROM mlm_hierarchy WHERE affiliate_id = $1 AND active = true';
                const parentResult = await client.query(parentQuery, [newParentId]);
                
                if (parentResult.rows.length > 0) {
                    const parent = parentResult.rows[0];
                    newLevel = parent.level + 1;
                    newPath = [...parent.path, affiliateId];
                }
            }

            // Atualizar afiliado
            await client.query(`
                UPDATE mlm_hierarchy 
                SET parent_id = $1, level = $2, path = $3, updated_at = CURRENT_TIMESTAMP
                WHERE affiliate_id = $4
            `, [newParentId, newLevel, newPath, affiliateId]);

            // Atualizar todos os descendentes
            await this.updateDescendants(client, affiliateId);
        } catch (error) {
            logger.error('Erro ao atualizar parent do afiliado:', error);
            throw error;
        }
    }

    // Atualizar descendentes após mudança de hierarquia
    async updateDescendants(client, affiliateId) {
        try {
            const descendants = await client.query(`
                SELECT affiliate_id, parent_id, path
                FROM mlm_hierarchy 
                WHERE $1 = ANY(path) AND affiliate_id != $1 AND active = true
                ORDER BY array_length(path, 1)
            `, [affiliateId]);

            for (const descendant of descendants.rows) {
                // Recalcular path e level
                const parentQuery = 'SELECT level, path FROM mlm_hierarchy WHERE affiliate_id = $1 AND active = true';
                const parentResult = await client.query(parentQuery, [descendant.parent_id]);
                
                if (parentResult.rows.length > 0) {
                    const parent = parentResult.rows[0];
                    const newLevel = parent.level + 1;
                    const newPath = [...parent.path, descendant.affiliate_id];

                    await client.query(`
                        UPDATE mlm_hierarchy 
                        SET level = $1, path = $2, updated_at = CURRENT_TIMESTAMP
                        WHERE affiliate_id = $3
                    `, [newLevel, newPath, descendant.affiliate_id]);
                }
            }
        } catch (error) {
            logger.error('Erro ao atualizar descendentes:', error);
            throw error;
        }
    }

    // Salvar CPA validado
    async saveCpaValidado(cpaData) {
        const client = await this.pool.connect();
        try {
            const query = `
                INSERT INTO cpa_validados 
                (user_id, affiliate_id, affiliate_level, cpa_amount, validation_rule_id, validation_criteria)
                VALUES ($1, $2, $3, $4, $5, $6)
                RETURNING *
            `;
            
            const values = [
                cpaData.user_id,
                cpaData.affiliate_id,
                cpaData.affiliate_level,
                cpaData.cpa_amount,
                cpaData.validation_rule_id,
                JSON.stringify(cpaData.validation_criteria)
            ];

            const result = await client.query(query, values);
            return result.rows[0];
        } catch (error) {
            logger.error('Erro ao salvar CPA validado:', error);
            throw error;
        } finally {
            client.release();
        }
    }

    // Salvar distribuição CPA
    async saveCpaDistribution(distributionData) {
        const client = await this.pool.connect();
        try {
            const query = `
                INSERT INTO cpa_distributions 
                (cpa_validado_id, user_id, affiliate_id, affiliate_level, original_amount, distributed_amount, transaction_id)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING *
            `;
            
            const values = [
                distributionData.cpa_validado_id,
                distributionData.user_id,
                distributionData.affiliate_id,
                distributionData.affiliate_level,
                distributionData.original_amount,
                distributionData.distributed_amount,
                distributionData.transaction_id
            ];

            const result = await client.query(query, values);
            return result.rows[0];
        } catch (error) {
            logger.error('Erro ao salvar distribuição CPA:', error);
            throw error;
        } finally {
            client.release();
        }
    }

    // Buscar CPAs de um afiliado
    async getAffiliateCpas(affiliateId, filters = {}) {
        const client = await this.pool.connect();
        try {
            let query = `
                SELECT 
                    cv.*,
                    cd.distributed_amount,
                    cd.distribution_date,
                    cd.transaction_id,
                    cd.status as distribution_status
                FROM cpa_validados cv
                LEFT JOIN cpa_distributions cd ON cv.id = cd.cpa_validado_id
                WHERE cv.affiliate_id = $1
            `;
            
            const params = [affiliateId];
            let paramIndex = 2;

            // Filtros opcionais
            if (filters.status) {
                query += ` AND cv.status = $${paramIndex}`;
                params.push(filters.status);
                paramIndex++;
            }

            if (filters.level) {
                query += ` AND cv.affiliate_level = $${paramIndex}`;
                params.push(filters.level);
                paramIndex++;
            }

            if (filters.dateFrom) {
                query += ` AND cv.validated_at >= $${paramIndex}`;
                params.push(filters.dateFrom);
                paramIndex++;
            }

            if (filters.dateTo) {
                query += ` AND cv.validated_at <= $${paramIndex}`;
                params.push(filters.dateTo);
                paramIndex++;
            }

            query += ' ORDER BY cv.validated_at DESC';

            if (filters.limit) {
                query += ` LIMIT $${paramIndex}`;
                params.push(filters.limit);
                paramIndex++;
            }

            const result = await client.query(query, params);
            return result.rows.map(row => {
                if (row.validation_criteria) {
                    row.validation_criteria = JSON.parse(row.validation_criteria);
                }
                return row;
            });
        } catch (error) {
            logger.error('Erro ao buscar CPAs do afiliado:', error);
            throw error;
        } finally {
            client.release();
        }
    }

    // Buscar estatísticas MLM
    async getAffiliateStatistics(affiliateId, periodStart, periodEnd) {
        const client = await this.pool.connect();
        try {
            const query = `
                SELECT * FROM mlm_statistics 
                WHERE affiliate_id = $1 
                AND period_start = $2 
                AND period_end = $3
            `;
            
            const result = await client.query(query, [affiliateId, periodStart, periodEnd]);
            return result.rows[0] || null;
        } catch (error) {
            logger.error('Erro ao buscar estatísticas MLM:', error);
            throw error;
        } finally {
            client.release();
        }
    }

    // Atualizar estatísticas MLM
    async updateAffiliateStatistics(affiliateId, periodStart, periodEnd, stats) {
        const client = await this.pool.connect();
        try {
            const query = `
                INSERT INTO mlm_statistics 
                (affiliate_id, period_start, period_end, total_cpas, total_amount, 
                 level_1_cpas, level_1_amount, level_2_cpas, level_2_amount,
                 level_3_cpas, level_3_amount, level_4_cpas, level_4_amount,
                 level_5_cpas, level_5_amount)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
                ON CONFLICT (affiliate_id, period_start, period_end)
                DO UPDATE SET
                    total_cpas = EXCLUDED.total_cpas,
                    total_amount = EXCLUDED.total_amount,
                    level_1_cpas = EXCLUDED.level_1_cpas,
                    level_1_amount = EXCLUDED.level_1_amount,
                    level_2_cpas = EXCLUDED.level_2_cpas,
                    level_2_amount = EXCLUDED.level_2_amount,
                    level_3_cpas = EXCLUDED.level_3_cpas,
                    level_3_amount = EXCLUDED.level_3_amount,
                    level_4_cpas = EXCLUDED.level_4_cpas,
                    level_4_amount = EXCLUDED.level_4_amount,
                    level_5_cpas = EXCLUDED.level_5_cpas,
                    level_5_amount = EXCLUDED.level_5_amount,
                    updated_at = CURRENT_TIMESTAMP
                RETURNING *
            `;
            
            const values = [
                affiliateId, periodStart, periodEnd,
                stats.total_cpas, stats.total_amount,
                stats.level_1_cpas, stats.level_1_amount,
                stats.level_2_cpas, stats.level_2_amount,
                stats.level_3_cpas, stats.level_3_amount,
                stats.level_4_cpas, stats.level_4_amount,
                stats.level_5_cpas, stats.level_5_amount
            ];

            const result = await client.query(query, values);
            return result.rows[0];
        } catch (error) {
            logger.error('Erro ao atualizar estatísticas MLM:', error);
            throw error;
        } finally {
            client.release();
        }
    }

    // Log de operação
    async logOperation(operationType, entityType, entityId, operationData, resultData, status, errorMessage = null, executionTime = null, createdBy = 'system') {
        const client = await this.pool.connect();
        try {
            const query = `
                INSERT INTO mlm_operation_logs 
                (operation_type, entity_type, entity_id, operation_data, result_data, status, error_message, execution_time_ms, created_by)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                RETURNING *
            `;
            
            const values = [
                operationType,
                entityType,
                entityId,
                operationData ? JSON.stringify(operationData) : null,
                resultData ? JSON.stringify(resultData) : null,
                status,
                errorMessage,
                executionTime,
                createdBy
            ];

            const result = await client.query(query, values);
            return result.rows[0];
        } catch (error) {
            logger.error('Erro ao salvar log de operação:', error);
            // Não propagar erro para não quebrar operação principal
        } finally {
            client.release();
        }
    }

    async close() {
        await this.pool.end();
    }
}

module.exports = MLMModel;

