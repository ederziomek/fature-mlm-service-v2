# 🏗️ Fature MLM Service V2

Serviço MLM migrado para Node.js com configurações 100% dinâmicas. Gerencia hierarquia MLM e distribuição automática de CPA baseada em regras configuráveis.

## 🎯 Características

- **Zero Hardcoded Values**: Todas as configurações vêm do Config Service
- **Hierarquia MLM Completa**: Gestão de upline/downline com até 5 níveis
- **Distribuição CPA Automática**: Processamento baseado em regras dinâmicas
- **Validação Configurável**: Critérios de CPA totalmente configuráveis
- **Jobs Automáticos**: Processamento em background configurável
- **Cache Inteligente**: Performance otimizada com auto-reload
- **Auditoria Completa**: Log de todas as operações
- **Estatísticas Detalhadas**: Métricas por afiliado e período

## 🚀 Instalação e Execução

### Pré-requisitos
- Node.js 18+
- PostgreSQL 12+
- Redis (opcional)
- Config Service rodando

### Configuração
1. Clone o repositório
2. Instale as dependências: `npm install`
3. Configure as variáveis de ambiente (veja `.env.example`)
4. Execute as migrações: `node src/database/migrate.js`
5. Inicie o serviço: `npm start`

### Variáveis de Ambiente
```bash
# Servidor
NODE_ENV=development
PORT=3002
HOST=0.0.0.0

# Banco de Dados MLM
DB_HOST=localhost
DB_PORT=5432
DB_NAME=fature_mlm
DB_USER=postgres
DB_PASSWORD=postgres

# Banco da Operação (Externo)
EXTERNAL_DB_HOST=177.115.223.216
EXTERNAL_DB_PORT=5999
EXTERNAL_DB_USER=userschapz
EXTERNAL_DB_PASSWORD=mschaphz8881!
EXTERNAL_DB_NAME=dados_interno

# Config Service
CONFIG_SERVICE_URL=http://localhost:3000/api/v1
CONFIG_SERVICE_WS_URL=ws://localhost:3000/ws/config
CONFIG_SERVICE_API_KEY=your_config_api_key

# Segurança
API_KEY_SECRET=your_mlm_api_key

# Jobs
ENABLE_CRON_JOBS=true
CPA_DISTRIBUTION_CRON=*/5 * * * *
```

## 📚 API Endpoints

### Processamento CPA
- `POST /api/v1/cpa/process` - Processar CPA para distribuição MLM
- `POST /api/v1/cpa/simulate` - Simular distribuição CPA
- `GET /api/v1/cpa/config` - Buscar configurações CPA atuais

### Hierarquia MLM
- `GET /api/v1/affiliate/:id/hierarchy` - Buscar hierarquia de um afiliado
- `GET /api/v1/affiliate/:id/upline` - Buscar upline de um afiliado
- `POST /api/v1/affiliate` - Criar afiliado na hierarquia
- `PUT /api/v1/affiliate` - Atualizar afiliado na hierarquia

### CPAs e Estatísticas
- `GET /api/v1/affiliate/:id/cpas` - Buscar CPAs de um afiliado
- `GET /api/v1/affiliate/:id/statistics` - Buscar estatísticas de um afiliado
- `GET /api/v1/summary` - Resumo geral do MLM

### Utilitários
- `GET /api/v1/health` - Health check
- `GET /api/v1/docs` - Documentação da API

## 🔄 Processamento CPA

### Fluxo Automático
1. **Job Automático**: Executa a cada 5 minutos (configurável)
2. **Busca CPAs**: Consulta banco da operação por CPAs pendentes
3. **Validação**: Aplica regras de validação dinâmicas
4. **Distribuição**: Calcula e executa distribuições MLM
5. **Auditoria**: Registra todas as operações

### Exemplo de Processamento Manual
```javascript
POST /api/v1/cpa/process
{
  "userId": 123,
  "affiliateId": 456,
  "cpaData": {
    "amount": 50.00,
    "depositAmount": 100.00,
    "betsCount": 15,
    "totalBetAmount": 500.00,
    "daysActive": 7
  }
}
```

### Resposta
```javascript
{
  "success": true,
  "message": "CPA processado com sucesso",
  "data": {
    "cpaValidado": { ... },
    "distributions": [
      {
        "affiliate_id": 456,
        "affiliate_level": 1,
        "distributed_amount": 50.00
      },
      {
        "affiliate_id": 789,
        "affiliate_level": 2,
        "distributed_amount": 20.00
      }
    ],
    "totalDistributed": 70.00
  }
}
```

## 🏗️ Hierarquia MLM

### Estrutura
- **Níveis**: Até 5 níveis configuráveis
- **Path**: Array com caminho completo na hierarquia
- **Upline**: Afiliados acima na hierarquia
- **Downline**: Afiliados abaixo na hierarquia

### Exemplo de Hierarquia
```
Nível 1: Afiliado 1 (R$ 50,00)
├── Nível 2: Afiliado 2 (R$ 20,00)
│   ├── Nível 3: Afiliado 4 (R$ 5,00)
│   └── Nível 3: Afiliado 5 (R$ 5,00)
└── Nível 2: Afiliado 3 (R$ 20,00)
    └── Nível 3: Afiliado 6 (R$ 5,00)
```

## ⚙️ Configurações Dinâmicas

### Valores CPA (via Config Service)
```json
{
  "cpa_level_amounts": {
    "level_1": 50.00,
    "level_2": 20.00,
    "level_3": 5.00,
    "level_4": 5.00,
    "level_5": 5.00
  }
}
```

### Regras de Validação
```json
{
  "cpa_validation_rules": {
    "groups": [
      {
        "operator": "AND",
        "criteria": [
          {"type": "deposit", "value": 30.00, "enabled": true},
          {"type": "bets", "value": 10, "enabled": true}
        ]
      }
    ],
    "group_operator": "OR"
  }
}
```

### Configurações MLM
```json
{
  "mlm_settings": {
    "max_hierarchy_levels": 5,
    "calculation_method": "standard",
    "auto_distribution": true,
    "minimum_amount": 0.01,
    "currency": "BRL"
  }
}
```

## 🔒 Autenticação

Todas as rotas (exceto health check) requerem autenticação via API Key:

```bash
# Header
X-API-Key: your_api_key

# Ou Authorization
Authorization: Bearer your_api_key
```

## 🤖 Jobs Automáticos

### Configuração
```bash
# Habilitar jobs
ENABLE_CRON_JOBS=true

# Processamento CPA (a cada 5 minutos)
CPA_DISTRIBUTION_CRON=*/5 * * * *

# Sincronização hierarquia (a cada 6 horas)
HIERARCHY_SYNC_CRON=0 */6 * * *
```

### Status do Job
```javascript
GET /api/v1/job/status
{
  "isRunning": false,
  "cronExpression": "*/5 * * * *",
  "enabled": true,
  "nextRun": "2025-01-15T10:05:00.000Z"
}
```

## 🐳 Docker

```bash
# Build
docker build -t fature-mlm-service-v2 .

# Run
docker run -p 3002:3002 \
  -e DB_HOST=your_db_host \
  -e CONFIG_SERVICE_URL=http://config-service:3000/api/v1 \
  -e API_KEY_SECRET=your_api_key \
  fature-mlm-service-v2
```

## 🚂 Deploy no Railway

1. Configure as variáveis de ambiente no Railway
2. Conecte o repositório GitHub
3. O deploy será automático

### Variáveis Obrigatórias no Railway
- `DATABASE_URL` (PostgreSQL)
- `CONFIG_SERVICE_URL`
- `CONFIG_SERVICE_API_KEY`
- `API_KEY_SECRET`

## 📊 Monitoramento

### Health Check
```javascript
GET /api/v1/health
{
  "success": true,
  "data": {
    "status": "healthy",
    "timestamp": "2025-01-15T10:00:00.000Z",
    "services": {
      "database": "connected",
      "configService": "connected"
    }
  }
}
```

### Logs
- `logs/combined.log` - Logs gerais
- `logs/error.log` - Apenas erros
- Formato JSON estruturado

## 🧪 Testes

```bash
# Testes unitários
npm test

# Testes com watch
npm run test:watch

# Coverage
npm run test:coverage
```

## 🔧 Desenvolvimento

```bash
# Modo desenvolvimento
npm run dev

# Lint
npm run lint

# Lint fix
npm run lint:fix
```

## 📈 Estatísticas

### Por Afiliado
- Total de CPAs no período
- Valor total distribuído
- Breakdown por nível MLM
- Histórico de distribuições

### Resumo Geral
- Total de afiliados ativos
- CPAs processados no período
- Valor total distribuído
- Média por afiliado

## 🔄 Integração com Config Service

### Auto-reload
O serviço se conecta via WebSocket ao Config Service e atualiza automaticamente quando configurações mudam:

```javascript
// Subscrição automática
configClient.subscribe('cpa_level_amounts', (newValues) => {
    console.log('Valores CPA atualizados:', newValues);
    // Cache local é atualizado automaticamente
});
```

### Cache Local
- Cache inteligente com TTL
- Fallback para valores padrão
- Reconexão automática

## 🤝 Contribuição

1. Fork o projeto
2. Crie uma branch para sua feature
3. Commit suas mudanças
4. Push para a branch
5. Abra um Pull Request

## 📄 Licença

MIT License - veja o arquivo LICENSE para detalhes.

---

**Fature MLM Service V2** - Hierarquia MLM e distribuição CPA com configurações dinâmicas 🚀

