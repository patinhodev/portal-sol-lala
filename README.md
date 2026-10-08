# Portal do Sol

Aplicação colaborativa para organizar o fim de semana, com listas de compras, notas fiscais, checklists e links individuais para os participantes.

## Estrutura

- `index.html`: página pública.
- `admin.html`: painel administrativo separado.
- `server.py`: servidor HTTP e API SQLite.
- `static/`: JavaScript, CSS, fotos e uploads de notas fiscais.
- `worker/`: API Cloudflare Workers e migrations D1.
- `weekend.db`: banco local de desenvolvimento; não deve ser versionado. Em Docker, os dados ficam em `/app/data`.

## Execução local

Defina a variável `PORTAL_ADMIN_PASSWORD_HASH` com o SHA-256 de `portal-sol-lala-admin:<senha>` e execute:

```powershell
$env:PORTAL_ADMIN_PASSWORD_HASH = "<hash>"
python server.py
```

Abra `http://127.0.0.1:8000/`. A administração fica em `http://127.0.0.1:8000/admin.html`.

## Segurança

- Publique somente atrás de HTTPS.
- Nunca versione `.env`, `weekend.db`, tokens ou fotos privadas.
- Faça backup periódico do diretório de dados antes de atualizar a aplicação.
- Troque os tokens individuais se um link for compartilhado indevidamente.
- Use uma senha administrativa forte e armazene somente o hash em variável de ambiente.
- O Cloudflare Pages hospeda arquivos estáticos, mas não executa este servidor Python. Para manter esta arquitetura, use um serviço com suporte a Python/Docker ou migre a API para Workers, D1 e R2.

## Publicação

O caminho público será exatamente `/dev-full-stack-fabiano`. Ele deve ser configurado no domínio do Cloudflare Pages; não é um mecanismo de segurança.

## Cloudflare Pages + Workers

O frontend pode ser publicado no Cloudflare Pages usando a raiz deste repositório. A API Cloudflare fica em `worker/` e usa D1 para os dados, inclusive fotos de notas fiscais de até 1 MB. O R2 não é necessário.

1. Instale o Wrangler e faça login:

```powershell
npm install -g wrangler
wrangler login
```

2. O D1 `portal-sol` já foi criado nesta conta. Confirme o `database_id` em `worker/wrangler.toml`. Se estiver configurando outra conta, crie o recurso:

```powershell
wrangler d1 create portal-sol
```

Copie o `database_id` retornado para `worker/wrangler.toml`.

3. Aplique a migration:

```powershell
wrangler d1 migrations apply portal-sol --remote --config worker/wrangler.toml
```

Gere os participantes com tokens novos e aplique o SQL no D1. Não versione o arquivo SQL gerado:

```powershell
node worker/scripts/generate-seed.mjs Ana Chintia Fabiano Lucas Renata Rodrigo Tuane Vincius > worker/seed.generated.sql
wrangler d1 execute portal-sol --remote --file worker/seed.generated.sql --config worker/wrangler.toml
Remove-Item worker/seed.generated.sql
```

4. Configure a senha administrativa sem colocá-la no Git:

```powershell
wrangler secret put PORTAL_ADMIN_PASSWORD_HASH --config worker/wrangler.toml
```

5. Publique a API e copie a URL `workers.dev` retornada:

```powershell
wrangler deploy --config worker/wrangler.toml
```

6. Publique o frontend no Pages:

```powershell
wrangler pages project create portal-sol-site --production-branch main
wrangler pages deploy . --project-name portal-sol-site
```

O Worker publicado nesta configuração usa `https://portal-sol-api.fabianojbandrade.workers.dev`. No domínio próprio, configure o caminho exatamente como `/dev-full-stack-fabiano`.

7. Configure a rota `/api/*` para o Worker no domínio do Pages, ou mantenha a URL `workers.dev` em `static/config.js`. Faça testes de leitura, gravação, administração, upload de nota e bloqueio antes de compartilhar os links.

O `database_id`, a senha e os tokens não devem ser commitados. No D1, as imagens ficam em Base64 e são limitadas a 1 MB para evitar crescimento descontrolado.
