export const normalizeConsentHandle = (value) => {
  if (value == null) return "";

  if (Array.isArray(value)) {
    return normalizeConsentHandle(value.find((item) => item != null && String(item).trim()));
  }

  const text = String(value).trim();
  if (!text) return "";

  const candidates = text
    .split(/[\r\n,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);

  return candidates[0] || text;
};

export const normalizeCamsConsentStatus = (value) => {
  if (value == null) return "";

  if (typeof value === "string") {
    return value.trim().toUpperCase();
  }

  if (typeof value === "object") {
    if (Object.prototype.hasOwnProperty.call(value, "consentStatus")) {
      return normalizeCamsConsentStatus(value.consentStatus);
    }

    if (Object.prototype.hasOwnProperty.call(value, "status")) {
      return normalizeCamsConsentStatus(value.status);
    }

    if (Object.prototype.hasOwnProperty.call(value, "data")) {
      return normalizeCamsConsentStatus(value.data);
    }
  }

  return "";
};

export const getCamsConsentId = (value) => {
  if (value == null) return "";

  if (typeof value === "object") {
    if (value.consentId) return String(value.consentId);
    if (value.data && typeof value.data === "object") {
      return getCamsConsentId(value.data);
    }
  }

  return "";
};

export const isCamsConsentActive = (response, explicitConsentId = null) => {
  const consentId = explicitConsentId ?? getCamsConsentId(response);
  const status = normalizeCamsConsentStatus(response);
  const activeStatuses = new Set([
    "ACTIVE",
    "APPROVED",
    "CONSENTED",
    "AUTHORIZED",
    "SUCCESS",
    "COMPLETED",
  ]);

  return activeStatuses.has(status) && Boolean(consentId);
};
