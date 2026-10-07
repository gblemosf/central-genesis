# Recuperação de senha

O login oferece “Esqueci minha senha”. O cliente Supabase solicita o e-mail com PKCE e retorno em `/auth/recovery`. O callback troca o código por sessão e redireciona para `/auth/reset-password`, sem manter o código na URL. A página valida o usuário com Auth; o formulário verifica novamente a identidade antes de salvar a senha e encerra as sessões após a alteração. Falhas no envio não são apresentadas como sucesso.

O link precisa ser aberto no mesmo navegador e domínio da solicitação, pois a troca usa o verificador PKCE salvo em cookie. Use o endereço estável do sistema, não o endereço de uma publicação antiga da Vercel.

## Configuração do Supabase hospedado

Em 07/10/2026, no projeto `hrcxlljvoemiaqhkihqp`:

- Site URL: `https://dash.gjempreendedorismo.com.br`.
- Retornos de recuperação autorizados: `https://dash.gjempreendedorismo.com.br/auth/recovery` e `https://centralgestaogenesis.vercel.app/auth/recovery`.
- Assunto de recuperação: `Redefina sua senha — Central Gênesis`.
- Corpo de recuperação: cópia de `supabase/templates/recovery.html`, salva no painel Authentication → Emails → Reset password.
- Envio padrão mantido por preferência do usuário. A equipe da organização possui apenas `business@gjempreendedorismo.com.br`, endereço elegível para esse envio. O serviço aceita somente endereços da equipe, atualmente com limite de 2 mensagens por hora e sem garantia de entrega. Um usuário da Central não se torna membro da equipe do Supabase automaticamente. Não houve teste de entrega real ou alteração de senha de usuário em produção.

O deploy da aplicação não aplica configurações de SMTP nem modelos de e-mail do projeto hospedado. Configure SMTP em Authentication → Emails → SMTP Settings com um provedor de envio e autentique o domínio com os registros DNS fornecidos por ele. Mantenha credenciais fora do repositório.

## Validação de entrega e recuperação

Solicite a recuperação na tela de login com uma conta de teste autorizada, abra o link no mesmo navegador, escolha e confirme uma nova senha e faça login novamente. Confira também um link expirado ou reutilizado, confirmação divergente e limite de solicitações. Não use senhas reais nos logs ou nos testes automatizados.
