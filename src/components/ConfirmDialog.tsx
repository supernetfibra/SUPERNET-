/**
 * ConfirmDialog — confirmação com conteúdo rico e ação assíncrona.
 *
 * Existe porque dois lugares precisam do mesmo comportamento: confirmar antes de
 * enviar uma mensagem de teste e antes de enviar um lembrete de fatura ao cliente.
 * Nos dois casos, o diálogo mostra *o que* vai sair (destino e texto) antes do
 * clique — confirmar sem ver a mensagem seria um carimbo, não uma decisão.
 *
 * O diálogo não fecha ao confirmar: fica aberto com o spinner até a ação terminar,
 * e é quem chamou que fecha. Sem isso, uma falha de envio sumiria com o diálogo.
 */

import { useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  /** Conteúdo extra: prévia da mensagem, dados do destinatário, avisos. */
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void | Promise<void>;
  /** Bloqueia a confirmação (ex.: dados ainda carregando). */
  disabled?: boolean;
  /** Classes extras do botão de confirmação (ex.: tom de alerta). */
  actionClassName?: string;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  confirmLabel,
  cancelLabel = "Cancelar",
  onConfirm,
  disabled,
  actionClassName,
}: ConfirmDialogProps) {
  const [working, setWorking] = useState(false);

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        // Enquanto envia, fechar deixaria o usuário sem saber o resultado.
        if (!working) onOpenChange(next);
      }}
    >
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle className="tracking-tight text-base">{title}</AlertDialogTitle>
          {description ? (
            <AlertDialogDescription className="text-xs">{description}</AlertDialogDescription>
          ) : null}
        </AlertDialogHeader>

        {children ? (
          <div className="max-h-[45vh] overflow-y-auto space-y-3 text-xs">{children}</div>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel className="cursor-pointer text-xs" disabled={working}>
            {cancelLabel}
          </AlertDialogCancel>
          <AlertDialogAction
            className={`cursor-pointer text-xs ${actionClassName ?? ""}`}
            disabled={disabled || working}
            onClick={async (event) => {
              event.preventDefault();
              setWorking(true);
              try {
                await onConfirm();
              } finally {
                setWorking(false);
              }
            }}
          >
            {working ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null}
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
