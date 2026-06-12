// PurchaseConfirmDialog
//
// Red-team P2 fix: the marketplace had no confirm step between "Buy"
// and "wallet debited". One mis-click on a $150 lead landed a charge
// the agent couldn't undo. This dialog adds a single intentional
// confirmation, showing the price + current wallet balance + the
// resulting balance, with a clear primary action.
//
// Pure presentation — the actual mutation stays with the caller, who
// passes `onConfirm`. We render nothing when `open` is false.

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AlertTriangle, DollarSign } from "lucide-react";

interface PurchaseConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId: number | null;
  price: string;
  // Current wallet balance as a number for arithmetic. Caller is
  // responsible for keeping this in sync with /api/auth/user.
  balance: number;
  onConfirm: () => Promise<void> | void;
  isPending: boolean;
}

export function PurchaseConfirmDialog({
  open,
  onOpenChange,
  leadId,
  price,
  balance,
  onConfirm,
  isPending,
}: PurchaseConfirmDialogProps) {
  const numPrice = parseFloat(price || "0");
  const hasFunds = balance >= numPrice;
  const afterBalance = Math.max(0, balance - numPrice);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-md w-[95vw] sm:w-full"
        data-testid="dialog-purchase-confirm"
      >
        <DialogHeader>
          <DialogTitle>Confirm purchase</DialogTitle>
          <DialogDescription>
            {leadId !== null && (
              <>You're about to buy lead #{leadId}. This debits your wallet immediately and can't be undone.</>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="flex justify-between items-center text-sm">
            <span className="text-muted-foreground">Lead price</span>
            <span className="font-semibold flex items-center gap-1">
              <DollarSign className="h-3.5 w-3.5" />
              {numPrice.toFixed(2)}
            </span>
          </div>
          <div className="flex justify-between items-center text-sm">
            <span className="text-muted-foreground">Wallet balance</span>
            <span className="font-medium">${balance.toFixed(2)}</span>
          </div>
          <div className="flex justify-between items-center text-sm border-t pt-2">
            <span className="text-muted-foreground">After purchase</span>
            <span
              className={`font-semibold ${hasFunds ? "text-foreground" : "text-destructive"}`}
              data-testid="text-after-balance"
            >
              ${afterBalance.toFixed(2)}
            </span>
          </div>

          {!hasFunds && (
            <div
              className="flex items-start gap-2 rounded border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 p-3 text-xs text-amber-900 dark:text-amber-100"
              data-testid="alert-insufficient-funds"
            >
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                You need ${(numPrice - balance).toFixed(2)} more to buy this lead. Add funds first.
              </span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
            data-testid="button-purchase-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={() => void onConfirm()}
            disabled={!hasFunds || isPending}
            data-testid="button-purchase-confirm"
            data-track-cta="purchase-confirm"
          >
            {isPending ? "Processing…" : `Confirm — $${numPrice.toFixed(2)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
