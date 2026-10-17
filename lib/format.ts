export function formatDateTime(value: string | Date) {
  return new Date(value).toLocaleString("en-AU", {
    timeZone: "Australia/Sydney",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatDate(value: string | Date) {
  return new Date(value).toLocaleDateString("en-AU", {
    timeZone: "Australia/Sydney",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export const DOC_LABELS: Record<string, string> = {
  id: "ID document",
  payslip: "Payslip",
  reference: "Rental reference",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(value: string) {
  return UUID_RE.test(value);
}
