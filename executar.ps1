Write-Host "Parando containers antigos..." -ForegroundColor Yellow
docker stop portal_lala_app 2>$null
docker rm portal_lala_app 2>$null

Write-Host "Construindo a imagem Docker..." -ForegroundColor Cyan
docker build -t portal-sol-lala .

Write-Host "Subindo o container na porta 8000..." -ForegroundColor Green
docker run -d -p 8000:8000 --name portal_lala_app --env-file .env portal-sol-lala

Write-Host "`nTudo pronto! Acesse no seu navegador: http://localhost:8000" -ForegroundColor White
Read-Host -Prompt "Pressione ENTER para fechar"