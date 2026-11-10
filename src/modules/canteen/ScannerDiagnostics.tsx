import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { BarcodeScanner } from '@capacitor-mlkit/barcode-scanning';
import { useTranslation } from 'react-i18next';
import type { ScannerDiagnostics as DiagData } from './CardScanner';

interface DiagState {
  platform: string;
  permission: string;
  pluginAvailable: boolean;
  lastError: string | null;
}

interface Props {
  lastScannerError: string | null;
  liveDiagnostics?: DiagData | null;
}

export function ScannerDiagnostics({ lastScannerError, liveDiagnostics }: Props) {
  const { t } = useTranslation();
  const isNative = Capacitor.isNativePlatform();
  const [diag, setDiag] = useState<DiagState>({
    platform: isNative ? 'native' : 'web',
    permission: 'unknown',
    pluginAvailable: false,
    lastError: lastScannerError,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let pluginAvailable = false;
      let permission = 'unknown';
      try {
        const result = await BarcodeScanner.checkPermissions();
        permission = result.camera;
        pluginAvailable = true;
      } catch (err) {
        pluginAvailable = false;
        permission = 'error';
        if (!cancelled) {
          setDiag((prev) => ({ ...prev, lastError: err instanceof Error ? err.message : String(err) }));
        }
      }
      if (!cancelled) {
        setDiag((prev) => ({
          ...prev,
          permission,
          pluginAvailable,
          lastError: lastScannerError ?? prev.lastError,
        }));
      }
    })();
    return () => { cancelled = true; };
  }, [lastScannerError]);

  const modeLabel = liveDiagnostics?.scannerMode
    ? t(`canteen.scanner.mode_${liveDiagnostics.scannerMode}`)
    : '—';
  const previewLabel = liveDiagnostics
    ? (liveDiagnostics.previewActive ? t('canteen.scanner.yes') : t('canteen.scanner.no'))
    : '—';

  return (
    <section className="flex flex-col gap-3 rounded-2xl bg-neutral-50 p-4 ring-1 ring-neutral-200">
      <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">{t('canteen.scanner.diagnosticsTitle')}</h2>
      <dl className="flex flex-col gap-2 text-sm">
        <div className="flex justify-between gap-2">
          <dt className="text-neutral-500">{t('canteen.scanner.diagPlatform')}</dt>
          <dd className="font-medium text-neutral-900">{diag.platform}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-neutral-500">{t('canteen.scanner.diagPermission')}</dt>
          <dd className="font-medium text-neutral-900">{diag.permission}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-neutral-500">{t('canteen.scanner.diagPlugin')}</dt>
          <dd className="font-medium text-neutral-900">{diag.pluginAvailable ? 'yes' : 'no'}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-neutral-500">{t('canteen.scanner.diagMode')}</dt>
          <dd className="font-medium text-neutral-900">{modeLabel}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-neutral-500">{t('canteen.scanner.diagPreview')}</dt>
          <dd className="font-medium text-neutral-900">{previewLabel}</dd>
        </div>
        {diag.lastError ? (
          <div className="flex flex-col gap-1">
            <dt className="text-neutral-500">{t('canteen.scanner.diagLastError')}</dt>
            <dd className="font-mono text-xs text-danger-700 break-words">{diag.lastError}</dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}
