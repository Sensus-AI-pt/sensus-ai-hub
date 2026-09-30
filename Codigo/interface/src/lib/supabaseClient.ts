import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://pvhkkeqzyuykdfkniyry.supabase.co";
const supabaseAnonKey = "sb_publishable_Wc6oHOw6MYmU-9fvoxQHhg_45Gku79w";

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // A sessão vive só em memória, e morre com a janela. Cada arranque da
    // aplicação volta ao ecrã de entrada e pede as credenciais outra vez.
    //
    // Antes o token era escrito em `localStorage` quando a caixa "lembrar
    // acesso" estava marcada, e o Supabase restaurava-o sozinho ao arrancar: a
    // app abria direta no painel com a sessão de quem a tinha usado antes. Num
    // equipamento de instalação, que passa por várias mãos, isso não é
    // conveniência nenhuma.
    //
    // A caixa "lembrar acesso" continua a fazer o que o seu texto diz —
    // recordar o acesso neste dispositivo — pela via que não é uma sessão
    // aberta: guarda o email para o pré-preencher (`sensus_remembered_email`).
    persistSession: false,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});
