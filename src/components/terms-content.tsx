/**
 * Terms of Use content — reusable across dialog and page.
 */

export default function TermsOfUseContent() {
  return (
    <div className="space-y-6 text-sm text-muted-foreground leading-relaxed">
      <p className="text-[10px] text-muted-foreground/60">
        Última atualização: Setembro de 2026
      </p>

      <section>
        <h3 className="text-sm font-medium text-foreground mb-2">1. Objeto</h3>
        <p>
          O presente instrumento estabelece os Termos e Condições Gerais de Uso
          e Contratação dos serviços de telecomunicações oferecidos pela empresa
          (doravante "<strong>Prestadora</strong>"), que disponibiliza serviços de acesso à
          internet por meio de tecnologia de fibra óptica (FTTH), conforme
          autorização da Agência Nacional de Telecomunicações (ANATEL).
        </p>
      </section>

      <section>
        <h3 className="text-sm font-medium text-foreground mb-2">2. Definições</h3>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Cliente/Usuário:</strong> pessoa física ou jurídica que contrata os serviços.</li>
          <li><strong>Área do Cliente:</strong> plataforma web para consulta de faturas, dados cadastrais e gerenciamento de serviços.</li>
          <li><strong>Serviço:</strong> prestação de acesso à internet e serviços complementares.</li>
          <li><strong>Plano:</strong> características e velocidades contratadas pelo Cliente.</li>
        </ul>
      </section>

      <section>
        <h3 className="text-sm font-medium text-foreground mb-2">3. Contratação e Vigência</h3>
        <p>
          3.1. A contratação é realizada mediante o preenchimento do formulário de solicitação, seguido
          por análise de viabilidade técnica e aprovação.
        </p>
        <p className="mt-1.5">
          3.2. O contrato é por prazo indeterminado, com rescisão mediante comunicação prévia de, no
          mínimo, 30 (trinta) dias.
        </p>
        <p className="mt-1.5">
          3.3. Alterações contratuais serão comunicadas com antecedência mínima de 30 dias, conforme
          Resolução nº 632/2014 da ANATEL.
        </p>
      </section>

      <section>
        <h3 className="text-sm font-medium text-foreground mb-2">4. Obrigações da Prestadora</h3>
        <ul className="list-disc pl-5 space-y-1">
          <li>Prestar o serviço com qualidade e continuidade (Resolução nº 575/2011 — ANATEL);</li>
          <li>Canal de atendimento para suporte, dúvidas e reclamações;</li>
          <li>Sigilo das comunicações e dados pessoais (LGPD);</li>
          <li>Emissão regular de nota fiscal / recibo;</li>
          <li>Comunicação prévia sobre interrupções programadas;</li>
          <li>Disponibilização do Plano de Atendimento ao Consumidor (PAC).</li>
        </ul>
      </section>

      <section>
        <h3 className="text-sm font-medium text-foreground mb-2">5. Obrigações do Cliente</h3>
        <ul className="list-disc pl-5 space-y-1">
          <li>Fornecer dados verdadeiros e atualizados;</li>
          <li>Efetuar pagamentos nas datas e condições da fatura;</li>
          <li>Utilizar o serviço de forma lícita, vedado uso para atividades ilícitas;</li>
          <li>Manter sigilo de CPF e senha, sendo responsável por uso indevido;</li>
          <li>Comunicar alterações nos dados cadastrais.</li>
        </ul>
      </section>

      <section>
        <h3 className="text-sm font-medium text-foreground mb-2">6. Faturamento e Pagamento</h3>
        <p>
          6.1. Faturas emitidas mensalmente, disponíveis na Área do Cliente.
        </p>
        <p className="mt-1.5">
          6.2. Atraso: multa de 2% + juros de mora de 1% ao mês (pro rata die).
        </p>
        <p className="mt-1.5">
          6.3. Não pagamento por 3 meses consecutivos poderá resultar em suspensão ou
          encerramento do contrato (Resolução nº 632/2014 — ANATEL).
        </p>
        <p className="mt-1.5">
          6.4. Divergências na fatura: revisão em até 30 dias via canal de atendimento.
        </p>
      </section>

      <section>
        <h3 className="text-sm font-medium text-foreground mb-2">7. Qualidade do Serviço</h3>
        <p>
          7.1. Velocidades indicadas representam a máxima de download. A efetiva pode variar
          conforme rede, horário e equipamento.
        </p>
        <p className="mt-1.5">
          7.2. Reparos em até 72 horas úteis, conforme Regulamento de Qualidade da ANATEL.
        </p>
      </section>

      <section>
        <h3 className="text-sm font-medium text-foreground mb-2">8. Proteção de Dados (LGPD)</h3>
        <p>
          O tratamento de dados pessoais é regido pela Lei nº 13.709/2018 (LGPD).
        </p>
        <ul className="list-disc pl-5 space-y-1 mt-1.5">
          <li>Dados coletados: identificação, contato, financeiros, navegação e imagens (quando fornecidas);</li>
          <li>Bases legais: execução de contrato (Art. 7º, V), obrigação legal (Art. 7º, II) e legítimo interesse (Art. 7º, IX);</li>
          <li>Logs de navegação mantidos por até 1 ano (Art. 15, Marco Civil);</li>
          <li>Direitos do titular: acesso, correção, eliminação, portabilidade — via canal de atendimento;</li>
          <li>Dados não são vendidos a terceiros.</li>
        </ul>
      </section>

      <section>
        <h3 className="text-sm font-medium text-foreground mb-2">9. Uso da Área do Cliente</h3>
        <p>
          Acesso protegido por CPF e senha. O Cliente é responsável pela confidencialidade de suas
          credenciais. A Prestadora não se responsabiliza por ações realizadas com uso válido.
        </p>
      </section>

      <section>
        <h3 className="text-sm font-medium text-foreground mb-2">10. Notificações Push</h3>
        <p>
          Inscrição voluntária, cancelável a qualquer momento nas configurações do dispositivo ou
          na Área do Cliente.
        </p>
      </section>

      <section>
        <h3 className="text-sm font-medium text-foreground mb-2">11. Propriedade Intelectual</h3>
        <p>
          Todo o conteúdo da Área do Cliente é de propriedade da Prestadora ou licenciantes,
          vedada reprodução sem autorização.
        </p>
      </section>

      <section>
        <h3 className="text-sm font-medium text-foreground mb-2">12. Isenção de Responsabilidade</h3>
        <p>A Prestadora não se responsabiliza por:</p>
        <ul className="list-disc pl-5 space-y-1 mt-1.5">
          <li>Interrupções por força maior ou caso fortuito;</li>
          <li>Danos por mau uso do serviço;</li>
          <li>Indisponibilidade temporária para manutenção;</li>
          <li>Conteúdo acessado pela rede.</li>
        </ul>
      </section>

      <section>
        <h3 className="text-sm font-medium text-foreground mb-2">13. Rescisão</h3>
        <p>
          13.1. Cliente: cancelamento mediante comunicação com 30 dias de antecedência.
        </p>
        <p className="mt-1.5">
          13.2. Prestadora: rescisão por inadimplência (3 meses), uso ilícito ou violação dos Termos.
        </p>
      </section>

      <section>
        <h3 className="text-sm font-medium text-foreground mb-2">14. Legislação Aplicável</h3>
        <ul className="list-disc pl-5 space-y-1">
          <li>Lei nº 12.965/2014 — Marco Civil da Internet</li>
          <li>Lei nº 13.709/2018 — LGPD</li>
          <li>Lei nº 8.078/1990 — Código de Defesa do Consumidor</li>
          <li>Resolução nº 632/2014 — Direitos do Consumidor (ANATEL)</li>
          <li>Resolução nº 575/2011 — Qualidade de Serviços (ANATEL)</li>
        </ul>
      </section>

      <section>
        <h3 className="text-sm font-medium text-foreground mb-2">15. Canal de Atendimento</h3>
        <p>
          Insatisfação? Registre reclamação na ANATEL: Disque 1331 ou{" "}
          <a
            href="https://www.anatel.gov.br/consumidor"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-foreground"
          >
            www.anatel.gov.br/consumidor
          </a>
        </p>
      </section>
    </div>
  );
}
