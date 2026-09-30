/**
 * Card "Mensagens dos lembretes" — vive em Configurações › Lembretes por WhatsApp.
 *
 * Movido do Simulador: os textos que a fila envia são configuração de produção, não
 * cenário de simulação. A prévia aqui usa dados de exemplo (a prévia com DADOS REAIS
 * continua no simulador, que é leitura).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, MessageSquareText, RotateCcw, Save } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiUrl } from "@/lib/api-config";
import {
  renderTemplatePreview,
  TEMPLATE_SAMPLE_PAYLOAD,
  TEMPLATE_MINIMAL_PAYLOAD,
  type TemplateEditorItem,
  type TemplateEntry,
  type TemplatesState,
} from "@/lib/simulator-report";

const ADMIN_TOKEN_KEY = "mikweb_admin_token";

function getAdminToken(): string | null {
  try {
    return localStorage.getItem(ADMIN_TOKEN_KEY);
  } catch {
    return null;
  }
}

function withAdminToken(url: string): string {
  const token = getAdminToken();
  if (!token) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}token=${encodeURIComponent(token)}`;
}

function adminFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(withAdminToken(apiUrl(url)), { ...init, credentials: "include" });
}

/** Rótulo curto do evento para o seletor. */
function templateEventLabel(eventKey: string): string {
  if (eventKey === "billing.due_soon") return "fatura a vencer";
  if (eventKey === "billing.due_today") return "vence hoje";
  if (eventKey === "billing.late") return "em atraso";
  if (eventKey === "referral.approved") return "indicação aprovada";
  return eventKey;
}

export function ReminderMessagesCard() {
  const [templatesState, setTemplatesState] = useState<TemplatesState | null>(null);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Record<string, TemplateEntry>>({});
  const [selectedTemplate, setSelectedTemplate] = useState<string>("whatsapp:billing.late");
  const [templatesSaving, setTemplatesSaving] = useState(false);
  const [showMinimalSample, setShowMinimalSample] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await adminFetch("/api/admin/notifications/templates");
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(typeof data?.error === "string" ? data.error : "Erro ao ler as mensagens.");
        setTemplatesState(data as TemplatesState);
        setTemplatesError(null);
        setEditing({});
      } catch (err) {
        setTemplatesError(err instanceof Error ? err.message : "Erro ao ler as mensagens.");
      }
    })();
  }, []);

  const templateItems: TemplateEditorItem[] = useMemo(
    () => templatesState?.templates ?? [],
    [templatesState]
  );

  /** Lista na ordem WhatsApp primeiro, eventos na ordem da régua (a vencer → hoje → atraso). */
  const orderedTemplates = useMemo(() => {
    const order = ["whatsapp", "push"];
    const eventOrder = ["billing.due_soon", "billing.due_today", "billing.late", "referral.approved"];
    return [...templateItems].sort(
      (a, b) =>
        order.indexOf(a.channel) - order.indexOf(b.channel) ||
        eventOrder.indexOf(a.eventKey) - eventOrder.indexOf(b.eventKey)
    );
  }, [templateItems]);

  const currentTemplate = orderedTemplates.find((t) => t.key === selectedTemplate) ?? orderedTemplates[0] ?? null;

  /** O que está no editor agora: original do servidor ou versão em edição. */
  const editingTemplate = currentTemplate
    ? editing[currentTemplate.key] ?? { body: currentTemplate.body, ...(currentTemplate.title ? { title: currentTemplate.title } : {}), active: currentTemplate.active }
    : null;

  const previewPayload = showMinimalSample ? TEMPLATE_MINIMAL_PAYLOAD : TEMPLATE_SAMPLE_PAYLOAD;
  const livePreview = editingTemplate ? renderTemplatePreview(editingTemplate.body, previewPayload) : null;
  const liveTitle = editingTemplate?.title ? renderTemplatePreview(editingTemplate.title, previewPayload) : null;

  const updateEditing = (key: string, patch: Partial<TemplateEntry>) =>
    setEditing((current) => {
      const base = current[key] ?? { body: "", active: true };
      return { ...current, [key]: { ...base, ...patch } };
    });

  /**
   * Preenche o editor com o texto PADRÃO do código. Não salva: ao clicar em
   * "Salvar mensagens", o servidor detecta a igualdade com o baseline e REMOVE o
   * override — o estado volta a ser "texto padrão" de verdade.
   */
  const resetTemplateToDefault = (key: string) => {
    const fallback = templatesState?.defaults?.[key];
    if (!fallback) return;
    updateEditing(key, {
      body: fallback.body,
      ...(fallback.title !== undefined ? { title: fallback.title } : {}),
      active: fallback.active,
    });
    toast.info("Texto padrão carregado — salve para aplicá-lo.");
  };

  /** O template atual diverge do padrão do código (editado no servidor ou no editor)? */
  const currentTemplateDiffersFromDefault = (() => {
    if (!currentTemplate || !editingTemplate) return false;
    const fallback = templatesState?.defaults?.[currentTemplate.key];
    if (!fallback) return false;
    return (
      editingTemplate.body !== fallback.body ||
      (editingTemplate.title ?? "") !== (fallback.title ?? "") ||
      editingTemplate.active !== fallback.active
    );
  })();

  const templatesDirty = Object.keys(editing).length > 0;

  const saveTemplatesNow = useCallback(async () => {
    if (!Object.keys(editing).length) return;
    setTemplatesSaving(true);
    try {
      const res = await adminFetch("/api/admin/notifications/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templates: editing }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data?.error === "string" ? data.error : "Erro ao salvar as mensagens.");
      setTemplatesState((current) => (current ? { ...current, ...(data as Partial<TemplatesState>) } : (data as TemplatesState)));
      setEditing({});
      toast.success("Mensagens salvas — o próximo envio já sai com o novo texto.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar as mensagens.");
    } finally {
      setTemplatesSaving(false);
    }
  }, [editing]);

  return (
    <Card className="border-border shadow-none animate-[slideUp_0.3s_ease-out_0.25s_both]">
      <CardHeader className="pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <MessageSquareText className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-sm font-medium tracking-tight">Mensagens dos lembretes</CardTitle>
            </div>
            <CardDescription className="text-xs text-muted-foreground">
              {templatesState?.origin === "db"
                ? "Textos salvos no painel"
                : "Textos padrão do código (nada salvo ainda)"}{" "}
              · prévia com dados de exemplo · o que salvar aqui é o que a fila envia
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {templatesDirty ? (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs h-8 cursor-pointer"
                onClick={() => setEditing({})}
              >
                <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                Descartar
              </Button>
            ) : null}
            <Button
              size="sm"
              className="text-xs h-8 cursor-pointer"
              disabled={!templatesDirty || templatesSaving}
              onClick={saveTemplatesNow}
            >
              {templatesSaving ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5 mr-1.5" />
              )}
              Salvar mensagens
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {templatesError ? (
          <p className="text-[11px] text-amber-600 dark:text-amber-400">
            {templatesError} O pipeline continua com os textos padrão do código.
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Select value={selectedTemplate} onValueChange={setSelectedTemplate}>
            <SelectTrigger className="h-8 w-64 text-xs cursor-pointer">
              <SelectValue placeholder="escolha a mensagem" />
            </SelectTrigger>
            <SelectContent>
              {orderedTemplates.map((template) => (
                <SelectItem key={template.key} value={template.key} className="text-xs">
                  {template.channel === "whatsapp" ? "WhatsApp" : "Push"} · {templateEventLabel(template.eventKey)}
                  {template.edited || editing[template.key] ? " •" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {currentTemplate ? (
            <Switch
              checked={editingTemplate?.active ?? currentTemplate.active}
              onCheckedChange={(checked) => updateEditing(currentTemplate.key, { active: checked })}
              className="cursor-pointer"
            />
          ) : null}
          <span className="text-[10px] text-muted-foreground">
            {currentTemplate?.edited || (currentTemplate && editing[currentTemplate.key]) ? "editado" : "texto padrão"}
          </span>
          {currentTemplateDiffersFromDefault ? (
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-8 cursor-pointer"
              onClick={() => resetTemplateToDefault(currentTemplate.key)}
            >
              <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
              Voltar ao padrão
            </Button>
          ) : null}
        </div>

        {currentTemplate && editingTemplate ? (
          <>
            <div className="space-y-2">
              <Label className="text-[10px] font-medium text-muted-foreground">
                Corpo da mensagem — {"{{campo}}"} substitui, {"{{#campo}}…{{/campo}}"} é opcional
              </Label>
              <Textarea
                value={editingTemplate.body}
                onChange={(event) => updateEditing(currentTemplate.key, { body: event.target.value })}
                className="min-h-44 text-xs font-mono"
                spellCheck={false}
              />
              {currentTemplate.channel === "push" ? (
                <div className="space-y-1.5">
                  <Label className="text-[10px] font-medium text-muted-foreground">Título do push</Label>
                  <Input
                    value={editingTemplate.title ?? ""}
                    onChange={(event) => updateEditing(currentTemplate.key, { title: event.target.value })}
                    className="h-8 text-xs font-mono"
                  />
                </div>
              ) : null}
              {livePreview?.missing.length ? (
                <p className="text-[10px] text-amber-600 dark:text-amber-400">
                  Campo desconhecido: {livePreview.missing.map((key) => `{{${key}}}`).join(", ")} — será enviado vazio.
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-[10px] font-medium text-muted-foreground">Prévia (como o cliente recebe)</Label>
                <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showMinimalSample}
                    onChange={(event) => setShowMinimalSample(event.target.checked)}
                    className="accent-foreground"
                  />
                  simular fatura sem Pix/boleto
                </label>
              </div>
              <div className="rounded-sm border border-border bg-muted/30 p-3 whitespace-pre-wrap text-xs leading-relaxed">
                {currentTemplate.channel === "push" && liveTitle?.body ? (
                  <p className="font-medium mb-1">{liveTitle.body}</p>
                ) : null}
                {livePreview?.body}
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {Object.entries(TEMPLATE_SAMPLE_PAYLOAD).map(([key, value]) => (
                <span
                  key={key}
                  title={value}
                  className="px-1.5 py-0.5 rounded-sm border border-border text-[10px] font-mono text-muted-foreground"
                >
                  {key}
                </span>
              ))}
            </div>
          </>
        ) : (
          <p className="text-[10px] text-muted-foreground">Carregando mensagens…</p>
        )}
      </CardContent>
    </Card>
  );
}
