export type TelemetryShedCode = 'TELEMETRY_SHED';

export interface TelemetryOperatorNotice {
  code: TelemetryShedCode;
  severity: 'warning';
  message: string;
}

export interface TelemetryWriteResult {
  recorded: boolean;
  shed: boolean;
  operatorNotice?: TelemetryOperatorNotice;
}

export function createTelemetryShedNotice(): TelemetryOperatorNotice {
  return {
    code: 'TELEMETRY_SHED',
    severity: 'warning',
    message: 'Operational telemetry is temporarily unavailable; user-facing chat continues without durable telemetry writes.',
  };
}

export function skippedTelemetryWrite(): TelemetryWriteResult {
  return { recorded: false, shed: false };
}

export function completedTelemetryWrite(): TelemetryWriteResult {
  return { recorded: true, shed: false };
}

export function shedTelemetryWrite(scope: string): TelemetryWriteResult {
  const operatorNotice = createTelemetryShedNotice();
  try {
    console.warn(JSON.stringify({
      event: 'telemetry_shed',
      code: operatorNotice.code,
      severity: operatorNotice.severity,
      scope,
      message: operatorNotice.message,
    }));
  } catch {}
  return { recorded: false, shed: true, operatorNotice };
}
