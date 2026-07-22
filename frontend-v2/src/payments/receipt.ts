import { Alert, Platform, Share } from 'react-native';

export type ReceiptData = {
  paymentId: string;
  amountLabel: string;
  planName?: string;
  paidTo?: string;
  dateTime: string;
  currency?: string;
  status?: string;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildReceiptHtml(data: ReceiptData): string {
  const paidTo = data.paidTo || 'ScanG';
  const plan = data.planName || 'Premium';
  const status = data.status || 'Paid';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ScanG Payment Receipt</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif; background: #0A0A0C; color: #FAFAFA; margin: 0; padding: 32px 20px; }
    .card { max-width: 480px; margin: 0 auto; background: #141417; border: 1px solid #27272A; border-radius: 16px; padding: 28px; }
    h1 { margin: 0 0 4px; font-size: 22px; }
    .sub { color: #A1A1AA; margin-bottom: 24px; font-size: 14px; }
    .row { display: flex; justify-content: space-between; gap: 16px; padding: 10px 0; border-bottom: 1px solid #1F1F22; font-size: 14px; }
    .label { color: #71717A; }
    .value { font-weight: 600; text-align: right; word-break: break-all; }
    .amount { color: #1A82FF; font-size: 18px; }
    .ok { color: #10B981; }
    .foot { margin-top: 24px; font-size: 12px; color: #71717A; text-align: center; }
    @media print { body { background: #fff; color: #111; } .card { border-color: #ddd; background: #fff; } .label { color: #666; } .amount { color: #0B57D0; } }
  </style>
</head>
<body>
  <div class="card">
    <h1>Payment Receipt</h1>
    <div class="sub">ScanG Premium · Secured by Razorpay</div>
    <div class="row"><span class="label">Status</span><span class="value ok">${escapeHtml(status)}</span></div>
    <div class="row"><span class="label">Transaction ID</span><span class="value">${escapeHtml(data.paymentId)}</span></div>
    <div class="row"><span class="label">Amount Paid</span><span class="value amount">${escapeHtml(data.amountLabel)}</span></div>
    <div class="row"><span class="label">Paid to</span><span class="value">${escapeHtml(paidTo)}</span></div>
    <div class="row"><span class="label">Plan</span><span class="value">${escapeHtml(plan)}</span></div>
    <div class="row"><span class="label">Date &amp; Time</span><span class="value">${escapeHtml(data.dateTime)}</span></div>
    <div class="foot">PCI-DSS compliant payment · Keep this receipt for your records</div>
  </div>
  <script>window.addEventListener('load', function(){ /* ready for print */ });</script>
</body>
</html>`;
}

export function buildReceiptText(data: ReceiptData): string {
  return [
    'ScanG Payment Receipt',
    '---------------------',
    `Status: ${data.status || 'Paid'}`,
    `Transaction ID: ${data.paymentId}`,
    `Amount Paid: ${data.amountLabel}`,
    `Paid to: ${data.paidTo || 'ScanG'}`,
    `Plan: ${data.planName || 'Premium'}`,
    `Date & Time: ${data.dateTime}`,
    '',
    'Secured by Razorpay · PCI-DSS compliant',
  ].join('\n');
}

/**
 * Web: download HTML receipt (and open print-friendly window).
 * Native: share receipt text via the system share sheet.
 */
export async function downloadReceipt(data: ReceiptData): Promise<void> {
  if (!data.paymentId) {
    Alert.alert('Receipt unavailable', 'Missing transaction ID for this payment.');
    return;
  }

  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    const html = buildReceiptHtml(data);
    const filename = `ScanG-receipt-${data.paymentId}.html`;

    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);

    // Also open a print-friendly tab so users can Save as PDF.
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.open();
      printWindow.document.write(html);
      printWindow.document.close();
      try {
        printWindow.focus();
        setTimeout(() => {
          try {
            printWindow.print();
          } catch {
            /* user can print manually */
          }
        }, 300);
      } catch {
        /* popup blocked — download still succeeded */
      }
    }

    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return;
  }

  try {
    await Share.share({
      title: 'ScanG Payment Receipt',
      message: buildReceiptText(data),
    });
  } catch {
    Alert.alert('Unable to share receipt', 'Please try again or copy the transaction ID from this screen.');
  }
}
