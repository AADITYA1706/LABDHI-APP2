import { useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";

export default function Otp() {
  const navigate = useNavigate();

  const camsData = JSON.parse(localStorage.getItem("camsData") || "{}");

  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  /* ==========================================
     VERIFY CONSENT
  ========================================== */
  const verifyOtp = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await axios.post(
        "/api/auth/verify-consent",
        {
          sessionId: camsData.sessionId,
          consentHandle: camsData.consentHandle,
          txnId: camsData.txnId || localStorage.getItem("txnId"),
          userId: camsData.userId || localStorage.getItem("employeeEmail"),
          otp,
        }
      );

      let status = res.data;
      const pollPayload = {
        sessionId: camsData.sessionId,
        consentHandle: camsData.consentHandle,
        txnId: camsData.txnId || localStorage.getItem("txnId"),
        userId: camsData.userId || localStorage.getItem("employeeEmail"),
      };

      for (let attempt = 0; attempt < 10 && status.consentStatus !== "ACTIVE"; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const poll = await axios.post("/api/cams/status", pollPayload);
        status = poll.data;
      }

      if (status.consentStatus !== "ACTIVE" || !status.consentId) {
        setError(status.message || "Consent approval is still pending");
        return;
      }

      // Save Consent
      localStorage.setItem("camsConsent", "true");
      localStorage.setItem("consentId", status.consentId);

      // Keep Session
      localStorage.setItem("sessionId", camsData.sessionId);
      localStorage.setItem("txnId", pollPayload.txnId || "");

      navigate("/dashboard");

    } catch (err) {
      setError(
        err.response?.data?.message || "Unable to verify consent"
      );
    } finally {
      setLoading(false);
    }
  };

  /* ==========================================
     RESEND OTP
  ========================================== */
  const resendOtp = async () => {
    try {
      await axios.post(
        "/api/auth/resend-otp",
        {
          sessionId: camsData.sessionId,
          consentHandle: camsData.consentHandle,
        }
      );

      alert("OTP Resent Successfully");

    } catch {
      alert("Unable to resend OTP");
    }
  };

  return (
    <div style={styles.container}>
      <form style={styles.card} onSubmit={verifyOtp}>
        <div style={styles.logo}>L</div>

        <h2 style={styles.title}>Verify OTP</h2>

        <p style={styles.subtitle}>
          Enter the 6-digit OTP sent to your registered mobile number
        </p>

        <input
          type="text"
          maxLength={6}
          value={otp}
          onChange={(e) =>
            setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))
          }
          placeholder="000000"
          style={styles.input}
          required
        />

        {error && <p style={styles.error}>{error}</p>}

        <button
          type="submit"
          disabled={loading}
          style={styles.button}
        >
          {loading ? "Verifying..." : "Verify OTP"}
        </button>

        <button
          type="button"
          onClick={resendOtp}
          style={styles.resend}
        >
          Resend OTP
        </button>
      </form>
    </div>
  );
}

const styles = {
  container: {
    minHeight: "100vh",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    background: "#eef4ff",
  },

  card: {
    width: 380,
    background: "#fff",
    borderRadius: 18,
    padding: 30,
    boxShadow: "0 10px 25px rgba(0,0,0,.10)",
    textAlign: "center",
  },

  logo: {
    width: 60,
    height: 60,
    borderRadius: "50%",
    background: "#2563eb",
    color: "#fff",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    margin: "0 auto 20px",
    fontSize: 28,
    fontWeight: 700,
  },

  title: {
    color: "#1e40af",
    marginBottom: 10,
  },

  subtitle: {
    color: "#64748b",
    fontSize: 14,
    marginBottom: 24,
  },

  input: {
    width: "100%",
    boxSizing: "border-box",
    padding: 14,
    fontSize: 22,
    textAlign: "center",
    letterSpacing: 8,
    borderRadius: 10,
    border: "1px solid #cbd5e1",
    marginBottom: 18,
  },

  button: {
    width: "100%",
    padding: 14,
    border: "none",
    borderRadius: 10,
    background: "#2563eb",
    color: "#fff",
    fontWeight: 600,
    cursor: "pointer",
    fontSize: 16,
  },

  resend: {
    marginTop: 16,
    border: "none",
    background: "transparent",
    color: "#2563eb",
    cursor: "pointer",
    fontWeight: 600,
  },

  error: {
    color: "#dc2626",
    marginBottom: 12,
    fontSize: 13,
  },
};