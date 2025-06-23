const axios = require('axios');
const WebSocket = require('ws');

/**
 * SDK Client para o Config Service
 * Usado por outros microserviços para buscar configurações dinamicamente
 */
class ConfigClient {
    constructor(options = {}) {
        this.baseURL = options.baseURL || process.env.CONFIG_SERVICE_URL || 'http://localhost:3000/api/v1';
        this.wsURL = options.wsURL || process.env.CONFIG_SERVICE_WS_URL || 'ws://localhost:3000/ws/config';
        this.apiKey = options.apiKey || process.env.CONFIG_SERVICE_API_KEY;
        this.timeout = options.timeout || 30000;
        
        // Cache local
        this.cache = new Map();
        this.cacheTTL = new Map();
        this.defaultCacheTTL = options.cacheTTL || 300000; // 5 minutos
        
        // WebSocket para notificações
        this.ws = null;
        this.wsReconnectInterval = options.wsReconnectInterval || 5000;
        this.wsMaxReconnectAttempts = options.wsMaxReconnectAttempts || 10;
        this.wsReconnectAttempts = 0;
        
        // Callbacks para mudanças
        this.changeCallbacks = new Map();
        
        // Configurar cliente HTTP
        this.httpClient = axios.create({
            baseURL: this.baseURL,
            timeout: this.timeout,
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': this.apiKey
            }
        });

        // Interceptor para logging
        this.httpClient.interceptors.response.use(
            response => response,
            error => {
                console.error('Config Client HTTP Error:', {
                    url: error.config?.url,
                    status: error.response?.status,
                    message: error.message
                });
                return Promise.reject(error);
            }
        );

        // Inicializar WebSocket se habilitado
        if (options.enableWebSocket !== false) {
            this.connectWebSocket();
        }
    }

    // Buscar configuração (com cache)
    async getConfig(key, defaultValue = null) {
        try {
            // Verificar cache primeiro
            const cached = this.getFromCache(key);
            if (cached !== null) {
                return cached;
            }

            // Para configurações CPA, usar endpoints específicos
            if (key === 'cpa_level_amounts') {
                return await this.getCpaLevelAmounts();
            }
            if (key === 'cpa_validation_rules') {
                return await this.getCpaValidationRules();
            }

            // Para outras configurações, usar endpoint genérico
            const response = await this.httpClient.get(`/config/${key}/value`);
            
            if (response.data.success) {
                const value = response.data.data.value;
                this.addToCache(key, value);
                return value;
            }
            
            return defaultValue;
        } catch (error) {
            if (error.response?.status === 404) {
                return defaultValue;
            }
            
            console.warn(`Erro ao buscar configuração ${key}, usando valor padrão:`, error.message);
            return defaultValue;
        }
    }

    // Buscar configuração completa (com metadados)
    async getConfigFull(key) {
        try {
            const response = await this.httpClient.get(`/config/${key}`);
            return response.data.success ? response.data.data : null;
        } catch (error) {
            if (error.response?.status === 404) {
                return null;
            }
            throw error;
        }
    }

    // Buscar configurações por categoria
    async getConfigsByCategory(category) {
        try {
            const response = await this.httpClient.get(`/configs/category/${category}`);
            return response.data.success ? response.data.data : [];
        } catch (error) {
            console.warn(`Erro ao buscar configurações da categoria ${category}:`, error.message);
            return [];
        }
    }

    // Buscar configurações por tipo
    async getConfigsByType(type) {
        try {
            const response = await this.httpClient.get(`/configs/type/${type}`);
            return response.data.success ? response.data.data : [];
        } catch (error) {
            console.warn(`Erro ao buscar configurações do tipo ${type}:`, error.message);
            return [];
        }
    }

    // Métodos específicos para configurações CPA
    async getCpaLevelAmounts() {
        try {
            // Usar endpoint correto do Config Service
            const response = await this.httpClient.get('/cpa/level-amounts');
            if (response.data.success) {
                return response.data.data;
            }
        } catch (error) {
            console.warn('Erro ao buscar valores CPA, usando padrão:', error.message);
        }
        
        // Fallback para valores padrão
        return {
            level_1: 50.00, level_2: 20.00, level_3: 5.00, level_4: 5.00, level_5: 5.00
        };
    }

    async getCpaValidationRules() {
        try {
            // Usar endpoint correto do Config Service
            const response = await this.httpClient.get('/cpa/validation-rules');
            if (response.data.success) {
                return response.data.data;
            }
        } catch (error) {
            console.warn('Erro ao buscar regras CPA, usando padrão:', error.message);
        }
        
        // Fallback para regras padrão
        return {
            groups: [],
            group_operator: 'OR'
        };
    }

    // Métodos específicos para configurações do sistema
    async getSystemSettings() {
        return await this.getConfig('system_settings', {
            api_timeout: 30000,
            cache_ttl: 3600,
            max_retries: 3,
            batch_size: 100,
            cpa_monitoring_interval: 300000
        });
    }

    // Métodos específicos para configurações MLM
    async getMlmSettings() {
        return await this.getConfig('mlm_settings', {
            max_hierarchy_levels: 5,
            calculation_method: 'standard',
            auto_distribution: true,
            minimum_amount: 0.01,
            currency: 'BRL'
        });
    }

    // Métodos específicos para configurações de APIs externas
    async getExternalApisSettings() {
        return await this.getConfig('external_apis', {
            operation_db: {
                sync_interval: 300000,
                batch_size: 1000,
                timeout: 30000
            },
            notification_service: {
                retry_attempts: 3,
                retry_delay: 5000
            }
        });
    }

    // Gerenciamento de cache
    getFromCache(key) {
        if (this.cache.has(key)) {
            const ttl = this.cacheTTL.get(key);
            if (ttl && Date.now() < ttl) {
                return this.cache.get(key);
            } else {
                // Cache expirado
                this.cache.delete(key);
                this.cacheTTL.delete(key);
            }
        }
        return null;
    }

    addToCache(key, value, ttl = null) {
        const expiry = Date.now() + (ttl || this.defaultCacheTTL);
        this.cache.set(key, value);
        this.cacheTTL.set(key, expiry);
    }

    clearCache(key = null) {
        if (key) {
            this.cache.delete(key);
            this.cacheTTL.delete(key);
        } else {
            this.cache.clear();
            this.cacheTTL.clear();
        }
    }

    // WebSocket para notificações em tempo real
    connectWebSocket() {
        try {
            this.ws = new WebSocket(this.wsURL);

            this.ws.on('open', () => {
                console.log('Config Client WebSocket conectado');
                this.wsReconnectAttempts = 0;
                
                // Subscrever a todas as configurações que temos callbacks
                const keysToSubscribe = Array.from(this.changeCallbacks.keys());
                if (keysToSubscribe.length > 0) {
                    this.ws.send(JSON.stringify({
                        action: 'subscribe',
                        keys: keysToSubscribe
                    }));
                }
            });

            this.ws.on('message', (data) => {
                try {
                    const message = JSON.parse(data.toString());
                    this.handleWebSocketMessage(message);
                } catch (error) {
                    console.error('Erro ao processar mensagem WebSocket:', error);
                }
            });

            this.ws.on('close', () => {
                console.log('Config Client WebSocket desconectado');
                this.scheduleReconnect();
            });

            this.ws.on('error', (error) => {
                console.error('Config Client WebSocket erro:', error);
            });

        } catch (error) {
            console.error('Erro ao conectar WebSocket:', error);
            this.scheduleReconnect();
        }
    }

    handleWebSocketMessage(message) {
        switch (message.type) {
            case 'config_changed':
                this.handleConfigChange(message.key, message.value);
                break;
            case 'connected':
                console.log('Config Client WebSocket:', message.message);
                break;
            case 'subscribed':
                console.log('Config Client subscrito a:', message.keys);
                break;
            case 'error':
                console.error('Config Client WebSocket erro:', message.message);
                break;
        }
    }

    handleConfigChange(key, newValue) {
        // Atualizar cache local
        this.addToCache(key, newValue);
        
        // Chamar callbacks registrados
        const callbacks = this.changeCallbacks.get(key);
        if (callbacks) {
            callbacks.forEach(callback => {
                try {
                    callback(newValue, key);
                } catch (error) {
                    console.error('Erro ao executar callback de mudança:', error);
                }
            });
        }
        
        console.log(`Configuração atualizada: ${key}`);
    }

    scheduleReconnect() {
        if (this.wsReconnectAttempts < this.wsMaxReconnectAttempts) {
            this.wsReconnectAttempts++;
            console.log(`Tentando reconectar WebSocket em ${this.wsReconnectInterval}ms (tentativa ${this.wsReconnectAttempts})`);
            
            setTimeout(() => {
                this.connectWebSocket();
            }, this.wsReconnectInterval);
        } else {
            console.error('Máximo de tentativas de reconexão WebSocket atingido');
        }
    }

    // Subscrever a mudanças de configuração
    subscribe(configKey, callback) {
        if (!this.changeCallbacks.has(configKey)) {
            this.changeCallbacks.set(configKey, new Set());
        }
        this.changeCallbacks.get(configKey).add(callback);

        // Se WebSocket está conectado, subscrever
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                action: 'subscribe',
                keys: [configKey]
            }));
        }
    }

    // Cancelar subscrição
    unsubscribe(configKey, callback) {
        if (this.changeCallbacks.has(configKey)) {
            this.changeCallbacks.get(configKey).delete(callback);
            
            // Se não há mais callbacks, cancelar subscrição no WebSocket
            if (this.changeCallbacks.get(configKey).size === 0) {
                this.changeCallbacks.delete(configKey);
                
                if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send(JSON.stringify({
                        action: 'unsubscribe',
                        keys: [configKey]
                    }));
                }
            }
        }
    }

    // Fechar conexões
    close() {
        if (this.ws) {
            this.ws.close();
        }
    }

    // Método utilitário para aguardar configuração
    async waitForConfig(key, timeout = 10000) {
        const startTime = Date.now();
        
        while (Date.now() - startTime < timeout) {
            const value = await this.getConfig(key);
            if (value !== null) {
                return value;
            }
            
            // Aguardar um pouco antes de tentar novamente
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        throw new Error(`Timeout aguardando configuração: ${key}`);
    }

    // Health check
    async healthCheck() {
        try {
            // Usar endpoint correto do Config Service
            const response = await this.httpClient.get('/api/v1/health');
            return response.data;
        } catch (error) {
            throw new Error(`Config Service indisponível: ${error.message}`);
        }
    }
}

module.exports = ConfigClient;

