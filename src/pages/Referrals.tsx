/**
 * Referrals Page — "Indique e Ganhe" (área do cliente).
 *
 * Mostra o link próprio com QR code, saldo, histórico de indicações e
 * resgates, e o catálogo de recompensas. O QR é gerado pela lib `qrcode`
 * (já usada no projeto) em data URL — sem dependência nova.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import {
  ArrowLeft,
  Gift,
  Check,
  Copy,
  Loader2,
  MessageCircle,
  Share2,
  Users,
  Coins,
  QrCode,
  ShoppingBag,
  Clock,
  XCircle,
  BadgeCheck,
} from "lucide-react";
import { toast } from "sonner";
import QRCode from "qrcode";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth-context";
import {
  fetchCatalog,
  fetchMyReferrals,
  redeemReward,
  type ReferralMeView,
  type ReferralReward,
} from "@/lib/referral-api";

const KIND_LABEL: Record<ReferralReward["kind"], string> = {
  desconto: "Desconto na fatura",
  bonificacao: "Bonificação",
  premiacao: "Premiação",
};

function formatPoints(n: number): string {
  return n.toLocaleString("pt-BR");
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function ReferralStatusBadge({ status }: { status: "pending" | "approved" | "rejected" }) {
  if (status === "approved") {
    return (
      <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30" variant="outline">
        <BadgeCheck className="h-3 w-3 mr-1" /> Aprovada
      </Badge>
    );
  }
  if (status === "rejected") {
    return (
      <Badge className="bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30" variant="outline">
        <XCircle className="h-3 w-3 mr-1" /> Não aprovada
      </Badge>
    );
  }
  return (
    <Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30" variant="outline">
      <Clock className="h-3 w-3 mr-1" /> Aguardando
    </Badge>
  );
}

function RedemptionStatusBadge({ status }: { status: "pending" | "approved" | "rejected" | "applied" }) {
  const map = {
    pending: { label: "Em análise", className: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30" },
    approved: { label: "Aprovado", className: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30" },
    applied: { label: "Aplicado", className: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30" },
    rejected: { label: "Recusado", className: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30" },
  } as const;
  const item = map[status];
  return (
    <Badge className={item.className} variant="outline">
      {item.label}
    </Badge>
  );
}

export default function Referrals() {
  const navigate = useNavigate();
  const { customer } = useAuth();
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<ReferralMeView | null>(null);
  const [rewards, setRewards] = useState<ReferralReward[]>([]);
  const [catalogEnabled, setCatalogEnabled] = useState(true);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [redeeming, setRedeeming] = useState<string | null>(null);
  const [confirmReward, setConfirmReward] = useState<ReferralReward | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const [mine, catalog] = await Promise.all([fetchMyReferrals(), fetchCatalog()]);
    if (mine.ok) {
      setView(mine.data);
    } else {
      setLoadError(mine.error);
    }
    if (catalog.ok) {
      setRewards(catalog.rewards);
      setCatalogEnabled(true);
    } else {
      setRewards([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // QR code do link próprio (data URL — sem rede externa)
  useEffect(() => {
    if (!view?.shareLink) {
      setQrDataUrl(null);
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(view.shareLink, { width: 320, margin: 1, errorCorrectionLevel: "M" })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [view?.shareLink]);

  const waShareUrl = useMemo(() => {
    if (!view?.shareText) return null;
    return `https://wa.me/?text=${encodeURIComponent(view.shareText)}`;
  }, [view?.shareText]);

  const handleCopy = async () => {
    if (!view?.shareLink) return;
    try {
      await navigator.clipboard.writeText(view.shareLink);
      setCopied(true);
      toast.success("Link copiado!");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Não foi possível copiar. Segure para selecionar o link.");
    }
  };

  const handleNativeShare = async () => {
    if (!view?.shareLink) return;
    const text = view.shareText ?? view.shareLink;
    if (navigator.share) {
      try {
        await navigator.share({ title: "Indique e ganhe", text, url: view.shareLink });
        return;
      } catch {
        // usuário cancelou — segue para o WhatsApp
      }
    }
    if (waShareUrl) window.open(waShareUrl, "_blank", "noopener");
  };

  const handleRedeem = async () => {
    if (!confirmReward) return;
    setRedeeming(confirmReward.id);
    const result = await redeemReward(confirmReward.id);
    setRedeeming(null);
    setConfirmReward(null);
    if (result.ok) {
      toast.success(result.duplicate ? "Você já tem um pedido em análise para esta recompensa." : "Resgate solicitado! Acompanhe em \"Seus resgates\".");
      await load();
    } else {
      toast.error(result.error);
    }
  };

  const canRedeem = (reward: ReferralReward) => Boolean(view && view.balance >= reward.points_cost);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border sticky top-0 bg-background/95 backdrop-blur z-10">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate("/dashboard")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <Gift className="h-5 w-5 text-primary" />
              <h1 className="text-base font-semibold tracking-tight">Indique e Ganhe</h1>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Indique e ganhe pontos por instalação aprovada.
            </p>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {loading ? (
          <div className="space-y-4">
            <Skeleton className="h-36 w-full rounded-xl" />
            <Skeleton className="h-64 w-full rounded-xl" />
          </div>
        ) : loadError && !view ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">{loadError}</CardContent>
          </Card>
        ) : view ? (
          <>
            {/* Resumo + link */}
            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="text-xs">
                  Compartilhe seu link. Quando a instalação indicada for <strong>aprovada</strong>, você ganha{" "}
                  <strong>{formatPoints(view.pointsPerApproved)} pontos</strong>.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border bg-muted/40 p-4">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                      <Coins className="h-3.5 w-3.5" /> Saldo de pontos
                    </div>
                    <div className="text-2xl font-bold tabular-nums">{formatPoints(view.balance)}</div>
                  </div>
                  <div className="rounded-lg border bg-muted/40 p-4">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                      <Users className="h-3.5 w-3.5" /> Indicações
                    </div>
                    <div className="text-2xl font-bold tabular-nums">{view.referrals.length}</div>
                  </div>
                </div>

                {view.code ? (
                  <div className="space-y-3">
                    <div className="text-xs text-muted-foreground">Seu link exclusivo</div>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <div className="flex-1 min-w-0 rounded-md border bg-muted/40 px-3 py-2 text-sm truncate font-mono">
                        {view.shareLink}
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" onClick={handleCopy} className="flex-1 sm:flex-none">
                          {copied ? <Check className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />}
                          {copied ? "Copiado" : "Copiar"}
                        </Button>
                        {/* Caminho principal: WhatsApp com a mensagem pronta — abre o
                            app/app web com o texto montado; o admin só escolhe o contato. */}
                        {waShareUrl && (
                          <Button
                            size="sm"
                            onClick={() => window.open(waShareUrl, "_blank", "noopener")}
                            className="flex-1 sm:flex-none bg-[#25D366] hover:bg-[#1eb857] text-white"
                          >
                            <MessageCircle className="h-4 w-4 mr-1" /> WhatsApp
                          </Button>
                        )}
                        <Button size="sm" variant="outline" onClick={handleNativeShare} className="flex-1 sm:flex-none">
                          <Share2 className="h-4 w-4 mr-1" /> Compartilhar
                        </Button>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 pt-1">
                      {qrDataUrl ? (
                        <img
                          src={qrDataUrl}
                          alt="QR code do seu link de indicação"
                          className="h-28 w-28 rounded-md border bg-white p-1.5"
                        />
                      ) : (
                        <div className="h-28 w-28 rounded-md border bg-muted/40 flex items-center justify-center">
                          <QrCode className="h-8 w-8 text-muted-foreground" />
                        </div>
                      )}
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        Mostre o QR code na loja ou envie o link pelo WhatsApp. Quem entrar por ele já vem identificado
                        como sua indicação no formulário de instalação.
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Seu link estará disponível em instantes. Tente novamente mais tarde.
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Catálogo */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <ShoppingBag className="h-4 w-4 text-primary" /> Troque seus pontos
                </CardTitle>
                {catalogEnabled ? (
                  <CardDescription className="text-xs">
                    Escolha uma recompensa. O pedido vai para análise e o crédito é lançado na sua fatura após a
                    confirmação.
                  </CardDescription>
                ) : (
                  <CardDescription className="text-xs">
                    O catálogo estará disponível em breve.
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent>
                {rewards.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">
                    {catalogEnabled
                      ? "Nenhuma recompensa disponível no momento."
                      : "O programa de recompensas está sendo preparado."}
                  </p>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {rewards.map((reward) => (
                      <div key={reward.id} className="rounded-lg border p-4 flex flex-col gap-2">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="text-sm font-medium leading-tight">{reward.title}</div>
                            <div className="text-xs text-muted-foreground">{KIND_LABEL[reward.kind]}</div>
                          </div>
                          <Badge variant="secondary" className="tabular-nums shrink-0">
                            {formatPoints(reward.points_cost)} pts
                          </Badge>
                        </div>
                        {reward.description && (
                          <p className="text-xs text-muted-foreground leading-relaxed">{reward.description}</p>
                        )}
                        <Button
                          size="sm"
                          variant={canRedeem(reward) ? "default" : "secondary"}
                          disabled={!canRedeem(reward) || redeeming === reward.id || !catalogEnabled}
                          onClick={() => setConfirmReward(reward)}
                          className="mt-auto w-full"
                        >
                          {redeeming === reward.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : canRedeem(reward) ? (
                            "Resgatar"
                          ) : (
                            `Faltam ${formatPoints(reward.points_cost - (view?.balance ?? 0))} pts`
                          )}
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Histórico */}
            <div className="grid gap-6 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Users className="h-4 w-4 text-primary" /> Suas indicações
                  </CardTitle>
                  <CardDescription className="text-xs">
                    {customer?.name ? `Indicações feitas pelo seu link, ${customer.name.split(" ")[0]}.` : "Indicações feitas pelo seu link."}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {view.referrals.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4 text-center">
                      Nenhuma indicação ainda. Compartilhe seu link!
                    </p>
                  ) : (
                    <ul className="space-y-3">
                      {view.referrals.map((r, i) => (
                        <li key={`${r.createdAt}-${i}`} className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-sm font-medium truncate">{r.name}</div>
                            <div className="text-xs text-muted-foreground">{formatDate(r.createdAt)}</div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {r.pointsEarned > 0 && (
                              <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">
                                +{formatPoints(r.pointsEarned)} pts
                              </span>
                            )}
                            <ReferralStatusBadge status={r.status} />
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Gift className="h-4 w-4 text-primary" /> Seus resgates
                  </CardTitle>
                  <CardDescription className="text-xs">Pedidos de recompensa e o status de cada um.</CardDescription>
                </CardHeader>
                <CardContent>
                  {view.redemptions.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4 text-center">
                      Nenhum resgate ainda. Troque seus pontos acima!
                    </p>
                  ) : (
                    <ul className="space-y-3">
                      {view.redemptions.map((r) => (
                        <li key={r.id} className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-sm font-medium truncate">{r.title}</div>
                            <div className="text-xs text-muted-foreground tabular-nums">
                              −{formatPoints(r.pointsCost)} pts · {formatDate(r.createdAt)}
                            </div>
                          </div>
                          <RedemptionStatusBadge status={r.status} />
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </div>
          </>
        ) : null}

        <Separator className="opacity-40" />
        <p className="text-[11px] text-muted-foreground text-center leading-relaxed max-w-md mx-auto pb-4">
          Pontos creditados quando a instalação indicada é aprovada pela equipe. Resgates sujeitos à confirmação.
          Programa sujeito a alterações.
        </p>
      </main>

      {/* Confirmação do resgate */}
      <Dialog open={Boolean(confirmReward)} onOpenChange={(open) => !open && setConfirmReward(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Confirmar resgate</DialogTitle>
            <DialogDescription>
              Trocar <strong>{confirmReward?.points_cost} pontos</strong> por{" "}
              <strong>{confirmReward?.title}</strong>? O valor vai para análise e não volta se o pedido for aceito.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmReward(null)}>
              Cancelar
            </Button>
            <Button onClick={handleRedeem} disabled={redeeming !== null}>
              {redeeming !== null && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
