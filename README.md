# Portal do Sol

Aplicação colaborativa para organizar o fim de semana, com listas de compras, notas fiscais, checklists e links individuais para os participantes.

## Estrutura

- `index.html`: página pública.
- `admin.html`: painel administrativo separado.
- `server.py`: servidor HTTP e API SQLite.
- `static/`: JavaScript, CSS, fotos e uploads de notas fiscais.
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

O caminho `/dev-full-stack-fabiano` pode ser usado como rota ou projeto no domínio, mas não substitui a hospedagem da API. Configure o proxy para encaminhar esse caminho ao servidor da aplicação e mantenha a API protegida por HTTPS.
