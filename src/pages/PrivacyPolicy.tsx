/**
 * Privacy Policy Page — Política de Privacidade
 * Compliant with LGPD (Lei nº 13.709/2018) and ANPD guidelines.
 */

import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router";
import { useBranding } from "@/lib/branding-context";

export default function PrivacyPolicy() {
  const navigate = useNavigate();
  const { providerName } = useBranding();

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-8"
        >
          <ArrowLeft className="h-3 w-3" />
          Voltar
        </button>

        <h1 className="text-2xl font-light tracking-tight text-foreground mb-2">
          Política de Privacidade
        </h1>
        <p className="text-xs text-muted-foreground mb-8">
          Última atualização: Setembro de 2026
        </p>

        <div className="space-y-8 text-sm text-muted-foreground leading-relaxed">
          {/* 1. Controlador dos Dados */}
          <section>
            <h2 className="text-base font-medium text-foreground mb-3">
              1. Controlador dos Dados
            </h2>
            <p>
              A empresa {providerName} (doravante "<strong>Prestadora</strong>"),
              inscrita no CNPJ sob nº [CNPJ], com sede em [endereço completo],
              é a controladora dos dados pessoais tratados por meio dos seus
              serviços e plataformas digitais, incluindo a Área do Cliente.
            </p>
            <p className="mt-2">
              Encarregado de Proteção de Dados (DPO): [nome do DPO] —
              [e-mail de contato do DPO].
            </p>
          </section>

          {/* 2. Dados Coletados */}
          <section>
            <h2 className="text-base font-medium text-foreground mb-3">
              2. Dados Pessoais Coletados
            </h2>
            <p>
              A Prestadora coleta os seguintes tipos de dados pessoais:
            </p>

            <h3 className="text-sm font-medium text-foreground mt-4 mb-2">
              2.1 Dados de Identificação
            </h3>
            <ul className="list-disc pl-5 space-y-1">
              <li>Nome completo</li>
              <li>CPF (Cadastro de Pessoa Física)</li>
              <li>RG (Registro Geral)</li>
              <li>Data de nascimento</li>
            </ul>

            <h3 className="text-sm font-medium text-foreground mt-4 mb-2">
              2.2 Dados de Contato
            </h3>
            <ul className="list-disc pl-5 space-y-1">
              <li>Endereço residencial (rua, número, complemento, bairro, cidade, estado, CEP)</li>
              <li>Número de telefone / WhatsApp</li>
              <li>Endereço de e-mail</li>
            </ul>

            <h3 className="text-sm font-medium text-foreground mt-4 mb-2">
              2.3 Dados Financeiros
            </h3>
            <ul className="list-disc pl-5 space-y-1">
              <li>Histórico de faturas e pagamentos</li>
              <li>Situação financeira da conta</li>
              <li>Dados de boletos e transações PIX</li>
            </ul>

            <h3 className="text-sm font-medium text-foreground mt-4 mb-2">
              2.4 Dados de Navegação e Uso do Serviço
            </h3>
            <ul className="list-disc pl-5 space-y-1">
              <li>Logs de acesso (data, hora, IP de origem, duração da sessão)</li>
              <li>Registro de ações realizadas na Área do Cliente</li>
              <li>Informações do dispositivo e navegador</li>
            </ul>

            <h3 className="text-sm font-medium text-foreground mt-4 mb-2">
              2.5 Dados de Imagens (quando fornecidos)
            </h3>
            <ul className="list-disc pl-5 space-y-1">
              <li>Fotos da residência (frente da casa e rua) — para fins de viabilidade de instalação</li>
              <li>Fotos de documento de identidade (frente e verso) — para fins de cadastro e verificação</li>
            </ul>
          </section>

          {/* 3. Finalidade do Tratamento */}
          <section>
            <h2 className="text-base font-medium text-foreground mb-3">
              3. Finalidade do Tratamento
            </h2>
            <p>
              Os dados pessoais são tratados para as seguintes finalidades:
            </p>
            <ul className="list-disc pl-5 space-y-1.5 mt-2">
              <li>
                <strong>Execução do contrato de prestação de serviços</strong> —
                cadastro, ativação, manutenção e faturamento do serviço de
                internet;
              </li>
              <li>
                <strong>Atendimento ao consumidor</strong> — suporte técnico,
                resolução de problemas e comunicações relacionadas ao serviço;
              </li>
              <li>
                <strong>Cumprimento de obrigação legal</strong> — atendimento a
                requisições de órgãos reguladores (ANATEL) e autoridades
                judiciais, conforme Marco Civil da Internet (Lei nº 12.965/2014);
              </li>
              <li>
                <strong>Viabilidade de instalação</strong> — avaliação técnica
                do local para instalação do equipamento;
              </li>
              <li>
                <strong>Prevenção à fraude</strong> — verificação de identidade
                e prevenção de cadastros fraudulentos;
              </li>
              <li>
                <strong>Melhoria do serviço</strong> — análise estatística de
                uso (dados agregados e anonimizados) para melhoria da
                infraestrutura.
              </li>
            </ul>
          </section>

          {/* 4. Base Legal */}
          <section>
            <h2 className="text-base font-medium text-foreground mb-3">
              4. Base Legal para o Tratamento
            </h2>
            <p>
              O tratamento de dados é realizado com base nos seguintes
              fundamentos da LGPD (Art. 7º):
            </p>
            <ul className="list-disc pl-5 space-y-1.5 mt-2">
              <li>
                <strong>Art. 7º, II</strong> — Cumprimento de obrigação legal ou
                regulatória pelo controlador (obrigações da ANATEL, Marco Civil
                da Internet);
              </li>
              <li>
                <strong>Art. 7º, V</strong> — Execução de contrato ou de
                procedimentos preliminares relacionados a contrato;
              </li>
              <li>
                <strong>Art. 7º, IX</strong> — Legítimo interesse do controlador
                (prevenção à fraude, melhoria do serviço).
              </li>
            </ul>
            <p className="mt-2">
              Para as fotos de identidade, o tratamento tem base no Art. 7º, V
              (execução de contrato) e Art. 7º, II (cumprimento de obrigação
              legal — verificação de identidade conforme normas da ANATEL).
            </p>
          </section>

          {/* 5. Compartilhamento de Dados */}
          <section>
            <h2 className="text-base font-medium text-foreground mb-3">
              5. Compartilhamento de Dados
            </h2>
            <p>
              Os dados pessoais poderão ser compartilhados com:
            </p>
            <ul className="list-disc pl-5 space-y-1.5 mt-2">
              <li>
                <strong>Órgãos reguladores</strong> — ANATEL e órgãos de defesa
                do consumidor, mediante requisição;
              </li>
              <li>
                <strong>Autoridades judiciais e policiais</strong> — mediante
                ordem judicial, conforme Art. 16 do Marco Civil da Internet;
              </li>
              <li>
                <strong>Prestadores de serviços auxiliares</strong> — empresas
                de cobrança, contabilidade e auditoria, limitados ao
                necessário para a prestação de seus serviços;
              </li>
              <li>
                <strong>Parceiros tecnológicos</strong> — provedores de
                infraestruturacloud e serviços de notificação push, sob
                contrato de tratamento de dados.
              </li>
            </ul>
            <p className="mt-2">
              A Prestadora <strong>não vende</strong> dados pessoais a terceiros.
            </p>
          </section>

          {/* 6. Retenção de Dados */}
          <section>
            <h2 className="text-base font-medium text-foreground mb-3">
              6. Retenção de Dados
            </h2>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>
                <strong>Dados cadastrais:</strong> mantidos durante toda a
                vigência do contrato e por 5 (cinco) anos após o encerramento,
                conforme prazo prescricional do Código Civil;
              </li>
              <li>
                <strong>Logs de navegação:</strong> mantidos por até 1 (um) ano,
                conforme Art. 15 da Lei nº 12.965/2014 (Marco Civil da Internet);
              </li>
              <li>
                <strong>Dados financeiros (faturas, pagamentos):</strong>
                mantidos por 5 (cinco) anos, conforme legislação tributária;
              </li>
              <li>
                <strong>Fotos de documento:</strong> mantidas pelo prazo
                necessário para verificação de identidade e, após conclusão
                do cadastro, serão eliminadas em até 90 (noventa) dias,
                salvo quando necessárias para cumprimento de obrigação legal;
              </li>
              <li>
                <strong>Fotos de residência:</strong> mantidas durante a
                vigência do contrato para fins de referência técnica.
              </li>
            </ul>
          </section>

          {/* 7. Direitos do Titular */}
          <section>
            <h2 className="text-base font-medium text-foreground mb-3">
              7. Direitos do Titular dos Dados
            </h2>
            <p>
              Conforme os Arts. 17 a 22 da LGPD, o titular dos dados pessoais
              tem direito a:
            </p>
            <ul className="list-disc pl-5 space-y-1.5 mt-2">
              <li>
                <strong>Confirmação</strong> da existência de tratamento de dados;
              </li>
              <li>
                <strong>Acesso</strong> aos dados pessoais tratados;
              </li>
              <li>
                <strong>Correção</strong> de dados incompletos, inexatos ou
                desatualizados;
              </li>
              <li>
                <strong>Anonimização, bloqueio ou eliminação</strong> de dados
                desnecessários, excessivos ou tratados em desconformidade
                com a LGPD;
              </li>
              <li>
                <strong>Portabilidade</strong> dos dados a outro fornecedor
                de serviço;
              </li>
              <li>
                <strong>Eliminação</strong> dos dados pessoais tratados com
                consentimento;
              </li>
              <li>
                <strong>Informação</strong> sobre entidades públicas e privadas
                com as quais houve uso compartilhado de dados;
              </li>
              <li>
                <strong>Informação</strong> sobre a possibilidade de não fornecer
                consentimento e sobre as consequências da negativa;
              </li>
              <li>
                <strong>Revogação do consentimento</strong>, a qualquer momento.
              </li>
            </ul>
            <p className="mt-2">
              Para exercer qualquer desses direitos, o Cliente poderá entrar em
              contato através do canal de atendimento da Prestadora.
            </p>
          </section>

          {/* 8. Segurança dos Dados */}
          <section>
            <h2 className="text-base font-medium text-foreground mb-3">
              8. Segurança dos Dados
            </h2>
            <p>
              A Prestadora adota medidas técnicas e administrativas aptas a
              proteger os dados pessoais de acessos não autorizados e de
              situações acidentais ou ilícitas de destruição, perda, alteração,
              comunicação ou qualquer forma de tratamento inadequado ou ilícito,
              incluindo:
            </p>
            <ul className="list-disc pl-5 space-y-1.5 mt-2">
              <li>Criptografia TLS/SSL em todas as comunicações;</li>
              <li>Autenticação por token de sessão com expiração;</li>
              <li>Controle de acesso baseado em perfil (admin vs. cliente);</li>
              <li>Logs de auditoria de todas as ações realizadas;</li>
              <li>Isolamento da infraestrutura backend (Supabase Edge Functions);</li>
              <li>Políticas de senha e proteção contra brute force.</li>
            </ul>
          </section>

          {/* 9. Cookies e Tecnologias Similares */}
          <section>
            <h2 className="text-base font-medium text-foreground mb-3">
              9. Cookies e Tecnologias Similares
            </h2>
            <p>
              A Área do Cliente utiliza armazenamento local do navegador
              (localStorage) para manter a sessão do usuário autenticada.
              Esses dados são armazenados exclusivamente no dispositivo do
              usuário e não são transmitidos para terceiros.
            </p>
            <p className="mt-2">
              O serviço pode utilizar Service Workers para funcionalidades
              de notificações push e cache offline, sem coleta de dados
              pessoais adicionais.
            </p>
          </section>

          {/* 10. Menores de Idade */}
          <section>
            <h2 className="text-base font-medium text-foreground mb-3">
              10. Menores de Idade
            </h2>
            <p>
              Os serviços da Prestadora são direcionados a maiores de 18 anos
              (ou menores emancipados). Caso dados de menores sejam coletados
              sem o consentimento do responsável legal, a Prestadora procederá
              à eliminação imediata dos referidos dados.
            </p>
          </section>

          {/* 11. Transferência Internacional */}
          <section>
            <h2 className="text-base font-medium text-foreground mb-3">
              11. Transferência Internacional de Dados
            </h2>
            <p>
              A infraestrutura de hospedagem da Área do Cliente utiliza
              provedores de nuvem com servidores localizados no Brasil.
              Caso ocorra transferência internacional de dados, será
              garantido, no mínimo, o grau de proteção previsto na LGPD.
            </p>
          </section>

          {/* 12. Alterações desta Política */}
          <section>
            <h2 className="text-base font-medium text-foreground mb-3">
              12. Alterações desta Política
            </h2>
            <p>
              A Prestadora poderá alterar esta Política de Privacidade a
              qualquer momento. As alterações serão comunicadas aos Clientes
              por meio da Área do Cliente ou por outros canais de comunicação,
              com antecedência mínima de 30 (trinta) dias para alterações
              substanciais.
            </p>
          </section>

          {/* 13. Contato e Canal de Atendimento */}
          <section>
            <h2 className="text-base font-medium text-foreground mb-3">
              13. Contato e Canal de Atendimento
            </h2>
            <p>
              Para exercer seus direitos ou esclarecer dúvidas sobre esta
              Política de Privacidade, entre em contato:
            </p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>E-mail: [e-mail de privacidade]</li>
              <li>Telefone / WhatsApp: [telefone]</li>
              <li>Área do Cliente: seção de perfil</li>
            </ul>
            <p className="mt-2">
              O Cliente também poderá registrar reclamação junto à Autoridade
              Nacional de Proteção de Dados (ANPD) pelo site{" "}
              <a
                href="https://www.gov.br/anpd"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-foreground"
              >
                www.gov.br/anpd
              </a>
              , ou junto à ANATEL pelo Disque 1331.
            </p>
          </section>
        </div>

        <div className="mt-12 pt-6 border-t border-border">
          <Button
            variant="outline"
            size="sm"
            className="text-xs h-9"
            onClick={() => navigate(-1)}
          >
            <ArrowLeft className="h-3 w-3 mr-1.5" />
            Voltar
          </Button>
        </div>
      </div>
    </div>
  );
}
