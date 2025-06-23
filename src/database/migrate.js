const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function createTables() {
    const client = await pool.connect();
    
    try {
        console.log('🚀 Iniciando criação das tabelas MLM...');

        // Criar extensão UUID se não existir
        await client.query(`
            CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
        `);

        // Tabela de hierarquia MLM
        await client.query(`
            CREATE TABLE IF NOT EXISTS mlm_hierarchy (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                affiliate_id INTEGER NOT NULL,
                parent_id INTEGER,
                level INTEGER NOT NULL DEFAULT 1,
                path INTEGER[] DEFAULT ARRAY[]::INTEGER[],
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                active BOOLEAN DEFAULT TRUE,
                
                CONSTRAINT unique_affiliate UNIQUE (affiliate_id),
                CONSTRAINT valid_level CHECK (level >= 1 AND level <= 10)
            );
        `);

        // Tabela de CPAs validados
        await client.query(`
            CREATE TABLE IF NOT EXISTS cpa_validados (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                user_id INTEGER NOT NULL,
                affiliate_id INTEGER NOT NULL,
                affiliate_level INTEGER NOT NULL CHECK (affiliate_level BETWEEN 1 AND 5),
                cpa_amount DECIMAL(10,2) NOT NULL,
                validation_rule_id VARCHAR(50) NOT NULL,
                validation_criteria JSONB NOT NULL,
                validated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                distributed_at TIMESTAMP,
                status VARCHAR(20) DEFAULT 'PENDING',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                
                CONSTRAINT valid_status CHECK (status IN ('PENDING', 'DISTRIBUTED', 'CANCELLED', 'ERROR'))
            );
        `);

        // Tabela de distribuições CPA
        await client.query(`
            CREATE TABLE IF NOT EXISTS cpa_distributions (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                cpa_validado_id UUID NOT NULL REFERENCES cpa_validados(id),
                user_id INTEGER NOT NULL,
                affiliate_id INTEGER NOT NULL,
                affiliate_level INTEGER NOT NULL,
                original_amount DECIMAL(10,2) NOT NULL,
                distributed_amount DECIMAL(10,2) NOT NULL,
                distribution_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                transaction_id VARCHAR(100),
                status VARCHAR(20) DEFAULT 'COMPLETED',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                
                CONSTRAINT valid_distribution_status CHECK (status IN ('PENDING', 'COMPLETED', 'FAILED', 'CANCELLED'))
            );
        `);

        // Tabela de estatísticas MLM
        await client.query(`
            CREATE TABLE IF NOT EXISTS mlm_statistics (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                affiliate_id INTEGER NOT NULL,
                period_start DATE NOT NULL,
                period_end DATE NOT NULL,
                total_cpas INTEGER DEFAULT 0,
                total_amount DECIMAL(12,2) DEFAULT 0.00,
                level_1_cpas INTEGER DEFAULT 0,
                level_1_amount DECIMAL(10,2) DEFAULT 0.00,
                level_2_cpas INTEGER DEFAULT 0,
                level_2_amount DECIMAL(10,2) DEFAULT 0.00,
                level_3_cpas INTEGER DEFAULT 0,
                level_3_amount DECIMAL(10,2) DEFAULT 0.00,
                level_4_cpas INTEGER DEFAULT 0,
                level_4_amount DECIMAL(10,2) DEFAULT 0.00,
                level_5_cpas INTEGER DEFAULT 0,
                level_5_amount DECIMAL(10,2) DEFAULT 0.00,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                
                CONSTRAINT unique_affiliate_period UNIQUE (affiliate_id, period_start, period_end)
            );
        `);

        // Tabela de logs de operações
        await client.query(`
            CREATE TABLE IF NOT EXISTS mlm_operation_logs (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                operation_type VARCHAR(50) NOT NULL,
                entity_type VARCHAR(50) NOT NULL,
                entity_id VARCHAR(100) NOT NULL,
                operation_data JSONB,
                result_data JSONB,
                status VARCHAR(20) NOT NULL,
                error_message TEXT,
                execution_time_ms INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                created_by VARCHAR(100),
                
                CONSTRAINT valid_operation_status CHECK (status IN ('SUCCESS', 'ERROR', 'WARNING'))
            );
        `);

        // Criar índices para performance
        const indexes = [
            'CREATE INDEX IF NOT EXISTS idx_mlm_hierarchy_affiliate ON mlm_hierarchy(affiliate_id)',
            'CREATE INDEX IF NOT EXISTS idx_mlm_hierarchy_parent ON mlm_hierarchy(parent_id)',
            'CREATE INDEX IF NOT EXISTS idx_mlm_hierarchy_level ON mlm_hierarchy(level)',
            'CREATE INDEX IF NOT EXISTS idx_mlm_hierarchy_active ON mlm_hierarchy(active)',
            
            'CREATE INDEX IF NOT EXISTS idx_cpa_validados_user ON cpa_validados(user_id)',
            'CREATE INDEX IF NOT EXISTS idx_cpa_validados_affiliate ON cpa_validados(affiliate_id)',
            'CREATE INDEX IF NOT EXISTS idx_cpa_validados_level ON cpa_validados(affiliate_level)',
            'CREATE INDEX IF NOT EXISTS idx_cpa_validados_status ON cpa_validados(status)',
            'CREATE INDEX IF NOT EXISTS idx_cpa_validados_date ON cpa_validados(validated_at)',
            
            'CREATE INDEX IF NOT EXISTS idx_cpa_distributions_affiliate ON cpa_distributions(affiliate_id)',
            'CREATE INDEX IF NOT EXISTS idx_cpa_distributions_user ON cpa_distributions(user_id)',
            'CREATE INDEX IF NOT EXISTS idx_cpa_distributions_date ON cpa_distributions(distribution_date)',
            'CREATE INDEX IF NOT EXISTS idx_cpa_distributions_status ON cpa_distributions(status)',
            
            'CREATE INDEX IF NOT EXISTS idx_mlm_statistics_affiliate ON mlm_statistics(affiliate_id)',
            'CREATE INDEX IF NOT EXISTS idx_mlm_statistics_period ON mlm_statistics(period_start, period_end)',
            
            'CREATE INDEX IF NOT EXISTS idx_mlm_logs_type ON mlm_operation_logs(operation_type)',
            'CREATE INDEX IF NOT EXISTS idx_mlm_logs_entity ON mlm_operation_logs(entity_type, entity_id)',
            'CREATE INDEX IF NOT EXISTS idx_mlm_logs_date ON mlm_operation_logs(created_at)',
            'CREATE INDEX IF NOT EXISTS idx_mlm_logs_status ON mlm_operation_logs(status)'
        ];

        for (const indexQuery of indexes) {
            await client.query(indexQuery);
        }

        console.log('✅ Tabelas MLM criadas com sucesso!');

        // Inserir dados de teste se necessário
        await insertTestData(client);

    } catch (error) {
        console.error('❌ Erro ao criar tabelas MLM:', error);
        throw error;
    } finally {
        client.release();
    }
}

async function insertTestData(client) {
    console.log('📋 Verificando dados de teste...');

    try {
        // Verificar se já existem dados
        const existingData = await client.query('SELECT COUNT(*) FROM mlm_hierarchy');
        const count = parseInt(existingData.rows[0].count);

        if (count === 0) {
            console.log('📝 Inserindo dados de teste da hierarquia MLM...');

            // Dados de teste da hierarquia MLM
            const testHierarchy = [
                { affiliate_id: 1, parent_id: null, level: 1, path: [1] },
                { affiliate_id: 2, parent_id: 1, level: 2, path: [1, 2] },
                { affiliate_id: 3, parent_id: 1, level: 2, path: [1, 3] },
                { affiliate_id: 4, parent_id: 2, level: 3, path: [1, 2, 4] },
                { affiliate_id: 5, parent_id: 2, level: 3, path: [1, 2, 5] },
                { affiliate_id: 6, parent_id: 3, level: 3, path: [1, 3, 6] },
                { affiliate_id: 7, parent_id: 4, level: 4, path: [1, 2, 4, 7] },
                { affiliate_id: 8, parent_id: 4, level: 4, path: [1, 2, 4, 8] },
                { affiliate_id: 9, parent_id: 5, level: 4, path: [1, 2, 5, 9] },
                { affiliate_id: 10, parent_id: 7, level: 5, path: [1, 2, 4, 7, 10] }
            ];

            for (const hierarchy of testHierarchy) {
                await client.query(`
                    INSERT INTO mlm_hierarchy (affiliate_id, parent_id, level, path)
                    VALUES ($1, $2, $3, $4)
                `, [hierarchy.affiliate_id, hierarchy.parent_id, hierarchy.level, hierarchy.path]);
            }

            console.log('✅ Dados de teste inseridos!');
        } else {
            console.log('⚠️  Dados já existem, pulando inserção de teste');
        }
    } catch (error) {
        console.error('❌ Erro ao inserir dados de teste:', error);
        // Não propagar erro para não quebrar a migração
    }
}

async function main() {
    try {
        await createTables();
        console.log('🎉 Migração MLM concluída com sucesso!');
    } catch (error) {
        console.error('💥 Erro na migração MLM:', error);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

// Executar se chamado diretamente
if (require.main === module) {
    main();
}

module.exports = { createTables, insertTestData };

