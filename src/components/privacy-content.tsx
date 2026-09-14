/**
 * Privacy Policy content — reusable across dialog and page.
 */

export default function PrivacyContent() {
  return (
    <div className="space-y-6 text-sm text-muted-foreground leading-relaxed">
      <p className="text-[10px] text-muted-foreground/60">
        Última atualização: Setembro de 2026
      </p>

      <section>
        <h3 className="text-sm font-medium text-foreground mb-2">1. Controlador dos Dados</h3>
        <p>
          A empresa é a controladora dos dados pessoais tratados por meio dos seus
          serviços e plataformas digitais, incluindo a Área do Cliente.
        </p>
        <p className="mt-1.5">
          Encarregado de Proteção de Dados (DPO): [nome] — [e-mail].
        </p>
      </section>

      <section>
        <h3 className="text-sm font-medium text-foreground mb-2">2. Dados Pessoais Coletados</h3>

        <h4 className="text-xs font-medium text-foreground mt-3 mb-1">2.1 Identificação</h4>
        <ul className="list-disc pl-5 space-y-0.5">
          <li>Nome completo, CPF, RG, data de nascimento</li>
        </ul>

        <h4 className="text-xs font-medium text-foreground mt-3 mb-1">2.2 Contato</h4>
        <ul className="list-disc pl-5 space-y-0.5">
          <li>Endereço residencial, telefone/WhatsApp, e-mail</li>
        </ul>

        <h4 className="text-xs font-medium text-foreground mt-3 mb-1">2.3 Financeiros</h4>
        <ul className="list-disc pl-5 space-y-0.5">
          <li>Histórico de faturas, pagamentos, boletos e PIX</li>
        </ul>

        <h4 className="text-xs font-medium text-foreground mt-3 mb-1">2.4 Navegação</h4>
        <ul className="list-disc pl-5 space-y-0.5">
          <li>Logs de acesso (data, hora, IP, duração), registro de ações na Área do Cliente</li>
        </ul>

        <h4 className="text-xs font-medium text-foreground mt-3 mb-1">2.5 Imagens (quando fornecidas)</h4>
        <ul className="list-disc pl-5 space-y-0.5">
          <li>Fotos da residência — viabilidade de instalação</li>
          <li>Fotos de documento de identidade — cadastro e verificação</li>
        </ul>
      </section>

      <section>
        <h3 className="text-sm font-medium text-foreground mb-2">3. Finalidade do Tratamento</h3>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Execução do contrato</strong> — cadastro, ativação, manutenção e faturamento;</li>
          <li><strong>Atendimento ao consumidor</strong> — suporte técnico e comunicações;</li>
          <li><strong>Obrigação legal</strong> — atendimento à ANATEL e autoridades judiciais;</li>
          <li><strong>Viabilidade de instalação</strong> — avaliação técnica do local;</li>
          <li><strong>Prevenção à fraude</strong> — verificação de identidade;</li>
          <li><strong>Melhoria do serviço</strong> — análise estatística (dados agregados).</li>
        </ul>
      </section>

      <section>
        <h3 className="text-sm font-medium text-foreground mb-2">4. Base Legal (LGPD — Art. 7º)</h3>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Art. 7º, II</strong> — Cumprimento de obrigação legal/regulatória;</li>
          <li><strong>Art. 7º, V</strong> — Execução de contrato;</li>
          <li><strong>Art. 7º, IX</strong> — Legítimo interesse (prevenção à fraude).</li>
        </ul>
        <p className="mt-1.5">
          Fotos de identidade: base legal Art. 7º, V (contrato) e Art. 7º, II (obrigação legal — verificação de identidade, ANATEL).
        </p>
      </section>

      <section>
        <h3 className="text-sm font-medium text-foreground mb-2">5. Compartilhamento de Dados</h3>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Órgãos reguladores</strong> — ANATEL e defesa do consumidor, mediante requisição;</li>
          <li><strong>Autoridades judiciais</strong> — ordem judicial (Art. 16, Marco Civil);</li>
          <li><strong>Prestadores auxiliares</strong> — cobrança, contabilidade, auditoria;</li>
          <li><strong>Parceiros tecnológicos</strong> — infraestrutura cloud, notificações push.</li>
        </ul>
        <p className="mt-1.5">
          A Prestadora <strong>não vende</strong> dados pessoais a terceiros.
        </p>
      </section>

      <section>
        <h3 className="text-sm font-medium text-foreground mb-2">6. Retenção de Dados</h3>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Cadastrais:</strong> vigência do contrato + 5 anos;</li>
          <li><strong>Logs de navegação:</strong> até 1 ano (Art. 15, Marco Civil);</li>
          <li><strong>Financeiros:</strong> 5 anos (legislação tributária);</li>
          <li><strong>Fotos de documento:</strong> eliminadas em até 90 dias após cadastro (salvo obrigação legal);</li>
          <li><strong>Fotos de residência:</strong> durante a vigência do contrato.</li>
        </ul>
      </section>

      <section>
        <h3 className="text-sm font-medium text-foreground mb-2">7. Direitos do Titular (Arts. 17-22)</h3>
        <ul className="list-disc pl-5 space-y-1">
          <li>Confirmação e acesso aos dados;</li>
          <li>Correção de dados incompletos;</li>
          <li>Anonimização, bloqueio ou eliminação;</li>
          <li>Portabilidade dos dados;</li>
          <li>Eliminação dos dados com consentimento;</li>
          <li>Informação sobre compartilhamento;</li>
          <li>Revogação do consentimento.</li>
        </ul>
      </section>

      <section>
        <h3 className="text-sm font-medium text-foreground mb-2">8. Segurança dos Dados</h3>
        <ul className="list-disc pl-5 space-y-1">
          <li>Criptografia TLS/SSL em todas as comunicações;</li>
          <li>Autenticação por token com expiração;</li>
          <li>Controle de acesso (admin vs. cliente);</li>
          <li>Logs de auditoria;</li>
          <li>Isolamento da infraestrutura backend;</li>
          <li>Proteção contra brute force.</li>
        </ul>
      </section>

      <section>
        <h3 className="text-sm font-medium text-foreground mb-2">9. Cookies e Armazenamento Local</h3>
        <p>
          A Área do Cliente utiliza localStorage para manter a sessão autenticada.
          Dados ficam no dispositivo do usuário e não são transmitidos a terceiros.
        </p>
      </section>

      <section>
        <h3 className="text-sm font-medium text-foreground mb-2">10. Menores de Idade</h3>
        <p>
          Serviços destinados a maiores de 18 anos. Dados de menores coletados sem
          consentimento serão eliminados imediatamente.
        </p>
      </section>

      <section>
        <h3 className="text-sm font-medium text-foreground mb-2">11. Transferência Internacional</h3>
        <p>
          Servidores localizados no Brasil. Em caso de transferência internacional,
          será garantido o grau de proteção da LGPD.
        </p>
      </section>

      <section>
        <h3 className="text-sm font-medium text-foreground mb-2">12. Alterações</h3>
        <p>
          Alterações comunicadas com 30 dias de antecedência via Área do Cliente ou outros canais.
        </p>
      </section>

      <section>
        <h3 className="text-sm font-medium text-foreground mb-2">13. Contato</h3>
        <ul className="list-disc pl-5 space-y-0.5">
          <li>E-mail: [e-mail de privacidade]</li>
          <li>Telefone / WhatsApp: [telefone]</li>
          <li>Área do Cliente: seção de perfil</li>
        </ul>
        <p className="mt-1.5">
          Reclamação junto à ANPD:{" "}
          <a
            href="https://www.gov.br/anpd"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-foreground"
          >
            www.gov.br/anpd
          </a>
          {" "} ou ANATEL Disque 1331.
        </p>
      </section>
    </div>
  );
}
