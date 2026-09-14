/**
 * Terms of Use Page — Termos de Uso e Contratação de Serviços de Internet
 * Compliant with ANATEL (Agência Nacional de Telecomunicações) regulations
 * and LGPD (Lei Geral de Proteção de Dados — Lei nº 13.709/2018).
 */

import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router";
import { useBranding } from "@/lib/branding-context";

export default function TermsOfUse() {
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
          Termos de Uso
        </h1>
        <p className="text-xs text-muted-foreground mb-8">
          Última atualização: Setembro de 2026
        </p>

        <div className="space-y-8 text-sm text-muted-foreground leading-relaxed">
          {/* 1. Objeto */}
          <section>
            <h2 className="text-base font-medium text-foreground mb-3">
              1. Objeto
            </h2>
            <p>
              O presente instrumento estabelece os Termos e Condições Gerais de
              Uso e Contratação dos serviços de telecomunicações oferecidos
              por {providerName} (doravante denominada "<strong> Prestadora</strong>"), que
              disponibiliza serviços de acesso à internet por meio de tecnologia
              de fibra óptica (FTTH) e outros meios de transmissão, conforme
              autorização concedida pela Agência Nacional de Telecomunicações
              (ANATEL).
            </p>
            <p className="mt-2">
              Ao acessar ou utilizar os serviços e o sistema web da Área do
              Cliente, o usuário declara ter lido, compreendido e concordado
              com estes Termos de Uso, com a Política de Privacidade e com a
              legislação aplicável.
            </p>
          </section>

          {/* 2. Definições */}
          <section>
            <h2 className="text-base font-medium text-foreground mb-3">
              2. Definições
            </h2>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>
                <strong>Cliente/Usuário:</strong> pessoa física ou jurídica que
                contrata os serviços de telecomunicações da Prestadora.
              </li>
              <li>
                <strong>Área do Cliente:</strong> plataforma web disponível para
                consulta de faturas, dados cadastrais, composição de contas e
                gerenciamento de serviços.
              </li>
              <li>
                <strong>Serviço:</strong> prestação de acesso à internet e
                serviços complementares oferecidos pela Prestadora.
              </li>
              <li>
                <strong>Plano:</strong> o conjunto de características e
                velocidades contratadas pelo Cliente, conforme tabela de
                planos vigente.
              </li>
            </ul>
          </section>

          {/* 3. Contratação e Vigência */}
          <section>
            <h2 className="text-base font-medium text-foreground mb-3">
              3. Contratação e Vigência
            </h2>
            <p>
              3.1. A contratação do serviço é realizada mediante o preenchimento
              do formulário de solicitação de instalação, followed pela análise
              de viabilidade técnica e aprovação pela Prestadora.
            </p>
            <p className="mt-2">
              3.2. A vigência do contrato é por prazo indeterminado, iniciando-se
              na data da ativação do serviço, podendo ser rescindido por
              qualquer das partes mediante comunicação prévia de, no mínimo,
              30 (trinta) dias.
            </p>
            <p className="mt-2">
              3.3. A Prestadora poderá alterar as condições contratuais
              comunicando ao Cliente com antecedência mínima de 30 (trinta) dias,
              conforme Resolução nº 632/2014 da ANATEL.
            </p>
          </section>

          {/* 4. Obrigações da Prestadora */}
          <section>
            <h2 className="text-base font-medium text-foreground mb-3">
              4. Obrigações da Prestadora
            </h2>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>
                Prestar o serviço com qualidade, continuidade e segurança, em
                conformidade com os padrões de qualidade estabelecidos pela
                ANATEL (Resolução nº 575/2011);
              </li>
              <li>
                Disponibilizar canal de atendimento ao consumidor para
                esclarecimento de dúvidas, registro de reclamações e
                solicitações;
              </li>
              <li>
                Manter sigilo das comunicações e dos dados pessoais dos Clientes,
                conforme LGPD;
              </li>
              <li>
                Fornecer nota fiscal/recibo de pagamento de forma regular;
              </li>
              <li>
                Comunicar com antecedência sobre interrupções programadas do
                serviço;
              </li>
              <li>
                Disponibilizar o Plano de Atendimento ao Consumidor (PAC),
                conforme exigido pela ANATEL.
              </li>
            </ul>
          </section>

          {/* 5. Obrigações do Cliente */}
          <section>
            <h2 className="text-base font-medium text-foreground mb-3">
              5. Obrigações do Cliente
            </h2>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>
                Fornecer dados verdadeiros e atualizados no momento da
                contratação e durante a vigência do contrato;
              </li>
              <li>
                Efetuar os pagamentos nas datas e condições estabelecidas na
                fatura;
              </li>
              <li>
                Utilizar o serviço de forma lícita, em conformidade com a
                legislação vigente, sendo vedado o uso para atividades
                ilícitas, fraudes ou violação de direitos de terceiros;
              </li>
              <li>
                Manter em sigilo suas credenciais de acesso (CPF e senha),
                sendo de sua responsabilidade qualquer uso indevido;
              </li>
              <li>
                Comunicar à Prestadora qualquer alteração nos dados cadastrais.
              </li>
            </ul>
          </section>

          {/* 6. Faturamento e Pagamento */}
          <section>
            <h2 className="text-base font-medium text-foreground mb-3">
              6. Faturamento e Pagamento
            </h2>
            <p>
              6.1. As faturas serão emitidas mensalmente, com vencimento no dia
              indicado no contrato de adesão, e disponíveis para consulta na
              Área do Cliente.
            </p>
            <p className="mt-2">
              6.2. O atraso no pagamento acarretará a incidência de multa de 2%
              sobre o valor devido, acrescido de juros de mora de 1% ao mês,
              calculados pro rata die, sem prejuízo de其他 penalidades previstas
              em lei.
            </p>
            <p className="mt-2">
              6.3. O não pagamento por 3 (três) meses consecutivos poderá
              resultar na suspensão do serviço e/ou no encerramento do contrato,
              conforme Resolução nº 632/2014 da ANATEL.
            </p>
            <p className="mt-2">
              6.4. Em caso de divergência na fatura, o Cliente poderá solicitar
              revisão junto ao canal de atendimento da Prestadora no prazo de
              30 (trinta) dias a partir da data de emissão.
            </p>
          </section>

          {/* 7. Qualidade do Serviço */}
          <section>
            <h2 className="text-base font-medium text-foreground mb-3">
              7. Qualidade do Serviço
            </h2>
            <p>
              7.1. A Prestadora compromete-se a manter os níveis de qualidade do
              serviço conforme indicadores de desempenho definidos pela ANATEL,
              incluindo, mas não se limitando a: disponibilidade da rede,
              velocidade contratada e tempo de resposta para reparos.
            </p>
            <p className="mt-2">
              7.2. Velocidades indicadas nos planos representam a velocidade
              máxima de download (e, quando aplicável, upload). A velocidade
              efetiva pode variar conforme condições de rede, horário e
              equipamento do usuário.
            </p>
            <p className="mt-2">
              7.3. A Prestadora realizará os esforços necessários para sanar
              eventuais defeitos no prazo máximo de 72 (setenta e duas) horas
              úteis, conforme Regulamento de Qualidade de Serviços da ANATEL.
            </p>
          </section>

          {/* 8. Proteção de Dados Pessoais (LGPD) */}
          <section>
            <h2 className="text-base font-medium text-foreground mb-3">
              8. Proteção de Dados Pessoais (LGPD)
            </h2>
            <p>
              8.1. O tratamento de dados pessoais dos Clientes é regido pela
              Lei Geral de Proteção de Dados Pessoais (Lei nº 13.709/2018 —
              LGPD) e pelas normas da Autoridade Nacional de Proteção de
              Dados (ANPD).
            </p>
            <p className="mt-2">
              8.2. A Prestadora coleta e trata os seguintes dados pessoais:
            </p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>Dados de identificação (nome, CPF, RG);</li>
              <li>Dados de contato (telefone, e-mail, endereço);</li>
              <li>Dados de navegação e uso do serviço (logs de acesso, horários de conexão);</li>
              <li>Dados financeiros (histórico de pagamentos, faturas).</li>
            </ul>
            <p className="mt-2">
              8.3. As bases legais para o tratamento são: execução de contrato
              (Art. 7º, V da LGPD), cumprimento de obrigação legal ou
              regulatória (Art. 7º, II) e legítimo interesse (Art. 7º, IX).
            </p>
            <p className="mt-2">
              8.4. O Cliente poderá, a qualquer momento, solicitar:
            </p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>Confirmação da existência de tratamento;</li>
              <li>Acesso aos seus dados pessoais;</li>
              <li>Correção de dados incompletos ou desatualizados;</li>
              <li>Anonimização, bloqueio ou eliminação de dados desnecessários;</li>
              <li>Portabilidade dos dados;</li>
              <li>Eliminação dos dados tratados com consentimento;</li>
              <li>Informação sobre compartilhamento de dados com terceiros;</li>
              <li>Revogação do consentimento.</li>
            </ul>
            <p className="mt-2">
              8.5. Os dados de navegação (logs) são mantidos por prazo de até
              1 (um) ano, conforme Art. 15 da Lei nº 12.965/2014 (Marco Civil
              da Internet), e poderão ser requisitados por autoridade judicial
              competente.
            </p>
          </section>

          {/* 9. Uso da Área do Cliente */}
          <section>
            <h2 className="text-base font-medium text-foreground mb-3">
              9. Uso da Área do Cliente
            </h2>
            <p>
              9.1. A Área do Cliente é um canal digital para consulta de
              informações e realização de ações como cópias de código de barras,
              PIX e download de boletos.
            </p>
            <p className="mt-2">
              9.2. O acesso é protegido por autenticação via CPF e senha.
              O Cliente é responsável por manter a confidencialidade de suas
              credenciais.
            </p>
            <p className="mt-2">
              9.3. A Prestadora não se responsabiliza por ações realizadas
              mediante uso válido das credenciais do Cliente.
            </p>
          </section>

          {/* 10. Notificações Push */}
          <section>
            <h2 className="text-base font-medium text-foreground mb-3">
              10. Notificações Push
            </h2>
            <p>
              10.1. O Cliente poderá optar por receber notificações push sobre
              vencimento de faturas, atualizações de conta e comunicados
              gerais da Prestadora.
            </p>
            <p className="mt-2">
              10.2. A inscrição em notificações push é voluntária e poderá ser
              cancelada a qualquer momento nas configurações do dispositivo ou
              na Área do Cliente.
            </p>
          </section>

          {/* 11. Propriedade Intelectual */}
          <section>
            <h2 className="text-base font-medium text-foreground mb-3">
              11. Propriedade Intelectual
            </h2>
            <p>
              Todo o conteúdo disponibilizado na Área do Cliente, incluindo
              mas não se limitando a textos, imagens, logotipos, interfaces e
              código-fonte, é de propriedade da Prestadora ou de seus
              licenciantes, sendo vedada sua reprodução, distribuição ou
              modificação sem autorização prévia.
            </p>
          </section>

          {/* 12. Isenção de Responsabilidade */}
          <section>
            <h2 className="text-base font-medium text-foreground mb-3">
              12. Isenção de Responsabilidade
            </h2>
            <p>
              A Prestadora não se responsabiliza por:
            </p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>Interrupções decorrentes de força maior ou caso fortuito;</li>
              <li>
                Danos decorrentes de mau uso do serviço pelo Cliente;
              </li>
              <li>
                Indisponibilidade temporária da Área do Cliente para manutenção
                ou atualização;
              </li>
              <li>
                Conteúdo acessado pelo Cliente por meio da rede de internet.
              </li>
            </ul>
          </section>

          {/* 13. Rescisão */}
          <section>
            <h2 className="text-base font-medium text-foreground mb-3">
              13. Rescisão
            </h2>
            <p>
              13.1. O Cliente poderá solicitar o cancelamento do serviço a
              qualquer momento, mediante comunicação ao canal de atendimento
              da Prestadora, com antecedência mínima de 30 (trinta) dias.
            </p>
            <p className="mt-2">
              13.2. A Prestadora poderá rescindir o contrato nas seguintes
              hipóteses:
            </p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>Inadimplência por 3 (três) meses consecutivos;</li>
              <li>Uso do serviço para fins ilícitos;</li>
              <li>Violação dos presentes Termos de Uso.</li>
            </ul>
          </section>

          {/* 14. Legislação Aplicável e Foro */}
          <section>
            <h2 className="text-base font-medium text-foreground mb-3">
              14. Legislação Aplicável e Foro
            </h2>
            <p>
              Estes Termos de Uso são regidos pela legislação brasileira,
              em especial:
            </p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>
                Lei nº 9.610/1998 — Lei de Direitos Autorais;
              </li>
              <li>
                Lei nº 12.965/2014 — Marco Civil da Internet;
              </li>
              <li>
                Lei nº 13.709/2018 — Lei Geral de Proteção de Dados (LGPD);
              </li>
              <li>
                Lei nº 8.078/1990 — Código de Defesa do Consumidor;
              </li>
              <li>
                Resolução nº 632/2014 — Direitos do Consumidor de Telecomunicações (ANATEL);
              </li>
              <li>
                Resolução nº 575/2011 — Regulamento de Qualidade de Serviços (ANATEL).
              </li>
            </ul>
            <p className="mt-2">
              Para dirimir quaisquer controvérsias oriundas destes Termos,
              fica eleito o foro da Comarca de instalação do serviço, com
              renúncia expressa a qualquer outro, por mais privilegiado que
              seja.
            </p>
          </section>

          {/* 15. Canal de Atendimento */}
          <section>
            <h2 className="text-base font-medium text-foreground mb-3">
              15. Canal de Atendimento
            </h2>
            <p>
              Para dúvidas, reclamações ou solicitações, o Cliente poderá
              entrar em contato através dos seguintes canais:
            </p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>Área do Cliente (portal web);</li>
              <li>Telefone / WhatsApp da Prestadora;</li>
              <li>E-mail de suporte.</li>
            </ul>
            <p className="mt-2">
              Em caso de insatisfação com a resposta da Prestadora, o Cliente
              poderá registrar reclamação junto à ANATEL pelo Disque 1331 ou
              pelo site{" "}
              <a
                href="https://www.anatel.gov.br/consumidor"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-foreground"
              >
                www.anatel.gov.br/consumidor
              </a>
              .
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
