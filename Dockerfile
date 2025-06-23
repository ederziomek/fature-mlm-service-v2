# Dockerfile para Fature MLM Service V2
FROM node:20-alpine

# Instalar dependências do sistema
RUN apk add --no-cache \
    postgresql-client \
    curl

# Criar diretório da aplicação
WORKDIR /app

# Copiar arquivos de dependências
COPY package*.json ./

# Instalar dependências
RUN npm ci --only=production

# Copiar código da aplicação
COPY src/ ./src/

# Criar diretório de logs
RUN mkdir -p logs

# Criar usuário não-root
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001

# Alterar propriedade dos arquivos
RUN chown -R nodejs:nodejs /app

# Mudar para usuário não-root
USER nodejs

# Expor portas
EXPOSE 3002

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3002/api/v1/health || exit 1

# Comando para iniciar a aplicação
CMD ["node", "src/app.js"]

