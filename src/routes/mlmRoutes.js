const express = require('express');
const MLMController = require('../controllers/mlmController');
const { validate, schemas, authenticate, rateLimits, validateParams } = require('../middleware/validation');

const router = express.Router();
const mlmController = new MLMController();

// Aplicar rate limiting geral
router.use(rateLimits.general);

// Health check (sem autenticação)
router.get('/health', mlmController.healthCheck.bind(mlmController));

// Aplicar autenticação para todas as rotas abaixo
router.use(authenticate);

// Rotas de processamento CPA
router.post('/cpa/process', 
    rateLimits.cpaProcessing,
    validate(schemas.processCpa),
    mlmController.processCpa.bind(mlmController)
);

router.post('/cpa/simulate', 
    rateLimits.read,
    validate(schemas.simulateDistribution),
    mlmController.simulateCpaDistribution.bind(mlmController)
);

router.get('/cpa/config', 
    rateLimits.read,
    mlmController.getCpaConfig.bind(mlmController)
);

// Rotas de hierarquia MLM
router.get('/affiliate/:affiliateId/hierarchy', 
    rateLimits.read,
    validateParams.affiliateId,
    mlmController.getHierarchy.bind(mlmController)
);

router.get('/affiliate/:affiliateId/upline', 
    rateLimits.read,
    validateParams.affiliateId,
    mlmController.getUpline.bind(mlmController)
);

// Rotas de afiliados
router.post('/affiliate', 
    rateLimits.write,
    validate(schemas.upsertAffiliate),
    mlmController.upsertAffiliate.bind(mlmController)
);

router.put('/affiliate', 
    rateLimits.write,
    validate(schemas.upsertAffiliate),
    mlmController.upsertAffiliate.bind(mlmController)
);

// Rotas de CPAs por afiliado
router.get('/affiliate/:affiliateId/cpas', 
    rateLimits.read,
    validateParams.affiliateId,
    mlmController.getAffiliateCpas.bind(mlmController)
);

// Rotas de estatísticas
router.get('/affiliate/:affiliateId/statistics', 
    rateLimits.read,
    validateParams.affiliateId,
    mlmController.getAffiliateStatistics.bind(mlmController)
);

// Rotas de resumo geral
router.get('/summary', 
    rateLimits.read,
    mlmController.getMlmSummary.bind(mlmController)
);

module.exports = router;

