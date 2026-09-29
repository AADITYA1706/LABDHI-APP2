import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";

const CAMS_STATUS_POLL_MS = 3000;
const CAMS_COMPLETION_TIMEOUT_MS = 14 * 60 * 1000;

export default function Cams() {
  const navigate = useNavigate();

  useEffect(() => {
    const consentId = localStorage.getItem("consentId");
    const consentActive = localStorage.getItem("camsConsent") === "true";

    if (consentId && consentActive) {
      navigate("/dashboard", { replace: true });
    }
  }, [navigate]);

  const [mobile, setMobile] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [journeyActive, setJourneyActive] = useState(false);
  const callbackStarted = useRef(false);
  const redirectStarted = useRef(false);
  const completionCheckStarted = useRef(false);
  const statusPollingLogStarted = useRef(false);
  const camsWindowRef = useRef(null);

  const logCamsPopupState = (event) => {
    const camsWindow = camsWindowRef.current;
    const popupExists = Boolean(camsWindow);
    const popupOpen = Boolean(popupExists && !camsWindow.closed);
    let popupUrl = null;
    let popupReturnedToCams = false;

    if (popupOpen) {
      try {
        const popupLocation = new URL(camsWindow.location.href);
        popupUrl = popupLocation.protocol === "about:"
          ? "about:blank"
          : `${popupLocation.origin}${popupLocation.pathname}`;
        popupReturnedToCams =
          popupLocation.origin === window.location.origin &&
          popupLocation.pathname === "/cams";
      } catch {
        popupUrl = null;
      }
    }

    console.info("[CAMS POPUP DIAGNOSTIC]", {
      event,
      popupExists,
      popupOpen,
      popupClosed: popupExists ? camsWindow.closed : null,
      popupUrl,
      popupUrlAccessible: Boolean(popupUrl),
      popupReturnedToCams,
    });
  };

  const params = new URLSearchParams(window.location.search);
  const ecres = params.get("ecres");
  const resdate = params.get("resdate");
  const clienttxnid = params.get("clienttxnid");

  const isCallback = Boolean(ecres && resdate);

  const clearCamsState = () => {
    [
      "camsData",
      "sessionId",
      "camsToken",
      "consentHandle",
      "txnId",
      "clientTxnId",
      "clienttxnid",
      "clienttrnxid",
      "consentId",
      "camsConsent",
      "camsPortfolio",
    ].forEach((key) => localStorage.removeItem(key));
  };

  const saveActiveConsent = (result, saved) => {
    localStorage.setItem("consentId", result.consentId || "");
    localStorage.setItem("consentHandle", result.consentHandle || saved.consentHandle || "");
    localStorage.setItem("sessionId", result.sessionId || saved.sessionId || "");
    localStorage.setItem("txnId", result.txnId || saved.txnId || "");
    localStorage.setItem("camsConsent", "true");
  };

  const startFreshCamsSession = async (customerMobile, targetWindow = window) => {
    clearCamsState();

    const redirecturl = `${window.location.origin}/cams`;
    const response = await axios.post(
      "http://localhost:5000/api/cams/redirect",
      {
        aaCustomerMobile: customerMobile,
        redirecturl,
      }
    );

    if (!response.data.success || !response.data.redirectionurl) {
      throw new Error(
        response.data.message ||
          "CAMS redirect URL not received"
      );
    }

    localStorage.setItem(
      "camsData",
      JSON.stringify({
        token: response.data.token,
        sessionId: response.data.sessionId,
        consentHandle: response.data.consentHandle,
        txnId: response.data.txnId,
        clienttxnid: response.data.clienttxnid,
        mobile: customerMobile,
      })
    );

    if (targetWindow !== window) {
      statusPollingLogStarted.current = false;
      completionCheckStarted.current = false;
      setJourneyActive(true);
    }

    targetWindow.location.href = response.data.redirectionurl;
  };

  /* =========================
     CAMS CALLBACK
  ========================= */
  useEffect(() => {
    if (!isCallback || callbackStarted.current) return;

    callbackStarted.current = true;
    console.info("[CAMS CALLBACK ARRIVAL]", {
      popupReturnedToCams: window.location.pathname === "/cams",
      callbackUrl: `${window.location.origin}${window.location.pathname}`,
      ecresPresent: Boolean(ecres),
      resdatePresent: Boolean(resdate),
      clienttxnidPresent: Boolean(clienttxnid),
    });

    if (window.opener && !window.opener.closed) {
      console.info("[CAMS COMPLETED]");
      window.opener.postMessage(
        {
          type: "CAMS_CALLBACK_READY",
          ecres,
          resdate,
          clienttxnid,
        },
        window.location.origin
      );
      console.info("CAMS completion detected", {
        callbackParametersPresent: Boolean(ecres && resdate),
        clienttxnidPresent: Boolean(clienttxnid),
      });
      window.close();
      return;
    }

    const completeCallback = async () => {
      try {
        setLoading(true);
        setError("");

        const saved = JSON.parse(
          localStorage.getItem("camsData") || "{}"
        );

        console.info("[CAMS CALLBACK REQUEST]", {
          callbackCalled: true,
          ecresReceived: Boolean(ecres),
          resdateReceived: Boolean(resdate),
          clientTxnIdReceived: Boolean(clienttxnid || saved.clienttxnid),
        });

        const statusResponse = await axios.post("/api/cams/status", {
          sessionId: saved.sessionId,
          consentHandle: saved.consentHandle,
          token: saved.token,
          txnId: saved.txnId,
        });

        if (
          !statusResponse.data.success ||
          statusResponse.data.consentStatus !== "ACTIVE" ||
          !statusResponse.data.consentId
        ) {
          throw new Error(
            statusResponse.data.message || "Consent is not active"
          );
        }
        if (!statusResponse.data.consentId) {
          throw new Error("Active consent ID was not returned");
        }
        saveActiveConsent(statusResponse.data, saved);
        sessionStorage.removeItem("camsRedirectRetry");

        if (window.opener && !window.opener.closed) {
          console.info("[CAMS POPUP DIAGNOSTIC] callback complete; closing popup");
          window.close();
          return;
        }

          navigate("/dashboard", { replace: true });
      } catch (err) {
        if (err.response) {
          let savedClientTxnIdPresent = Boolean(clienttxnid);
          try {
            savedClientTxnIdPresent ||= Boolean(
              JSON.parse(localStorage.getItem("camsData") || "{}").clienttxnid
            );
          } catch {
            savedClientTxnIdPresent = false;
          }

          console.info("[CAMS CALLBACK DIAGNOSTIC]", {
            callbackCalled: true,
            ecresReceived: Boolean(ecres),
            resdateReceived: Boolean(resdate),
            clientTxnIdReceived: savedClientTxnIdPresent,
            callbackResponseStatus: err.response.status,
            callbackSuccess: Boolean(err.response.data?.success),
            callbackConsentStatus: err.response.data?.consentStatus || null,
            portfolioFetched: err.response.data?.portfolioFetched === true,
            finalNavigationTarget: "not navigated",
          });
        }

        setError(
          err.response?.data?.message ||
            err.message ||
            "Unable to complete CAMS callback"
        );
      } finally {
        setLoading(false);
      }
    };

    completeCallback();
  }, [
    ecres,
    resdate,
    clienttxnid,
    isCallback,
    navigate,
  ]);

  useEffect(() => {
    if (!journeyActive) return undefined;

    let stopped = false;
    let pollingStopped = false;
    let pollTimer = null;
    let statusPollController = null;
    const journeyStartedAt = Date.now();
    const stopPolling = () => {
      pollingStopped = true;
      if (pollTimer !== null) window.clearInterval(pollTimer);
      statusPollController?.abort();
      statusPollController = null;
    };

    const navigateAfterCompletion = () => {
      stopped = true;
      stopPolling();
      setJourneyActive(false);
      console.info("[CAMS COMPLETION CONDITIONS]", {
        consentIdExists: Boolean(localStorage.getItem("consentId")),
        camsConsentExists: localStorage.getItem("camsConsent") === "true",
        active: true,
        completionCondition: "ACTIVE consent",
      });
      if (camsWindowRef.current && !camsWindowRef.current.closed) {
        camsWindowRef.current.close();
      }
      console.info("[DASHBOARD NAVIGATION]");
      console.info("navigate('/dashboard') about to execute");
      console.info("[NAVIGATING TO DASHBOARD]");
      navigate("/dashboard", { replace: true });
      console.info("navigate('/dashboard') executed");
    };

    let processPopupCallback;

    processPopupCallback = () => {
      if (!stopped) void pollConsentStatus();
    };

    const pollConsentStatus = async () => {
      if (stopped || pollingStopped || completionCheckStarted.current) return;

      if (Date.now() - journeyStartedAt >= CAMS_COMPLETION_TIMEOUT_MS) {
        stopPolling();
        stopped = true;
        setJourneyActive(false);
        if (camsWindowRef.current && !camsWindowRef.current.closed) {
          camsWindowRef.current.close();
        }
        logCamsPopupState("completion timeout");
        setError("CAMS consent completion was not confirmed. Please try again.");
        return;
      }

      completionCheckStarted.current = true;
      logCamsPopupState("status poll started");
      try {
        const saved = JSON.parse(localStorage.getItem("camsData") || "{}");
        if (
          !saved.sessionId ||
          !saved.clienttxnid ||
          !saved.consentHandle ||
          !saved.txnId
        ) {
          return;
        }

        statusPollController = new AbortController();
        const statusResponse = await axios.post(
          "/api/cams/status",
          {
            sessionId: saved.sessionId,
            consentHandle: saved.consentHandle,
            token: saved.token,
            txnId: saved.txnId,
          },
          { signal: statusPollController.signal }
        );
        statusPollController = null;
        console.info("[CAMS STATUS RESPONSE]", {
          httpStatus: statusResponse.status,
          consentStatus: statusResponse.data.consentStatus,
          consentIdExists: Boolean(statusResponse.data.consentId),
        });
        console.info(`[POLL RESPONSE] status=${statusResponse.data.consentStatus || "unknown"}`);
        logCamsPopupState("status response");

        if (stopped) return;
        if (
          statusResponse.data.consentStatus !== "ACTIVE" ||
          !statusResponse.data.consentId
        ) {
          return;
        }

        saveActiveConsent(statusResponse.data, saved);
        setError("");
        navigateAfterCompletion();
      } catch (completionError) {
        if (completionError.code !== "ERR_CANCELED") {
          console.info(
            `[POLL RESPONSE] status=HTTP_ERROR_${completionError.response?.status || "unknown"}`
          );
          console.info("[CAMS STATUS RESPONSE]", {
            httpStatus: completionError.response?.status || null,
            consentStatus: completionError.response?.data?.consentStatus || null,
          });
        }
        console.info("[CAMS COMPLETION STATUS]", {
          statusCheckFailed: true,
          httpStatus: completionError.response?.status || null,
        });
        if (!stopped && completionError.code !== "ERR_CANCELED") {
          setError(
            completionError.response?.data?.message ||
              completionError.message ||
              "Unable to confirm CAMS consent completion."
          );
        }
      } finally {
        completionCheckStarted.current = false;
      }
    };

    const handleCamsMessage = (event) => {
      if (
        event.origin !== window.location.origin ||
        event.source !== camsWindowRef.current ||
        event.data?.type !== "CAMS_CALLBACK_READY"
      ) {
        return;
      }

      console.info("[CAMS COMPLETED]");
      void processPopupCallback();
    };

    pollTimer = window.setInterval(
      pollConsentStatus,
      CAMS_STATUS_POLL_MS
    );
    if (!statusPollingLogStarted.current) {
      statusPollingLogStarted.current = true;
      console.info("[POLL STARTED]");
      logCamsPopupState("polling started");
    }
    const storageTimer = window.setTimeout(
      pollConsentStatus,
      0
    );
    window.addEventListener("message", handleCamsMessage);

    return () => {
      stopped = true;
      stopPolling();
      window.clearTimeout(storageTimer);
      window.removeEventListener("message", handleCamsMessage);
    };
  }, [journeyActive, navigate]);

  /* =========================
     START CAMS JOURNEY
  ========================= */
  const continueToCAMS = async (e) => {
    e.preventDefault();
    setError("");

    if (redirectStarted.current) return;

    if (mobile.length !== 10) {
      setError(
        "Enter valid 10 digit mobile number"
      );
      return;
    }

    const camsWindow = window.open("about:blank", "_blank");
    if (!camsWindow) {
      setError("Allow pop-ups to continue to CAMS while Labdhi stays open.");
      return;
    }

    console.info("[CAMS POPUP OPENED]", {
      popupOpened: true,
      popupOpen: !camsWindow.closed,
    });
    redirectStarted.current = true;
    camsWindowRef.current = camsWindow;

    try {
      setLoading(true);
      sessionStorage.removeItem("camsRedirectRetry");
      await startFreshCamsSession(mobile, camsWindow);
    } catch (err) {
      camsWindow.close();
      setError(
        err.response?.data?.message ||
          err.message ||
          "Unable to connect CAMS"
      );
    } finally {
      setLoading(false);
      redirectStarted.current = false;
    }
  };

  /* =========================
     UI
  ========================= */
  return (
    <div className="login-page">
      <div className="login-card">
        <div className="logo">L</div>

        <h1 className="title">
          CAMS Finserv
        </h1>

        <p className="subtitle">
          Enter your registered mobile
          number to continue
        </p>

        <form
          className="login-form"
          onSubmit={continueToCAMS}
        >
          <input
            type="tel"
            className="input"
            placeholder="Registered Mobile Number"
            maxLength={10}
            value={mobile}
            onChange={(e) =>
              setMobile(
                e.target.value.replace(
                  /\D/g,
                  ""
                )
              )
            }
          />

          <button
            className="btn"
            disabled={loading || journeyActive}
          >
            {loading
              ? "Connecting..."
              : "Continue to CAMS"}
          </button>

          {journeyActive && (
            <p role="status">Waiting for CAMS consent completion...</p>
          )}

          {error && (
            <p className="error-message">
              {error}
            </p>
          )}
        </form>

        <button
          className="logout-btn"
          onClick={() => {
            localStorage.clear();
            navigate("/");
          }}
        >
          Back
        </button>
      </div>
    </div>
  );
}