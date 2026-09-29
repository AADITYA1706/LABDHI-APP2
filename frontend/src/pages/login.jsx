import { useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";

export default function Login() {
  const navigate = useNavigate();

  const [username, setUsername] = useState("kunalr@labdhi.in");
  const [password, setPassword] = useState("Admin@12");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");

    const trimmedUsername = username.trim();
    const trimmedPassword = password.trim();

    if (!trimmedUsername || !trimmedPassword) {
      setError("Please enter CAMS username and password");
      return;
    }

    try {
      setLoading(true);

      const { data } = await axios.post("/api/auth/login", {
        username: trimmedUsername,
        password: trimmedPassword,
      });

      if (!data.success) {
        setError(data.message || "CAMS Login Failed");
        return;
      }

      const cams = data.data || {};

      localStorage.setItem("userId", cams.userId || username.trim());
      localStorage.setItem("camsSessionId", cams.sessionId || "");
      localStorage.setItem("camsRedirectUrl", cams.redirectUrl || "");
      localStorage.setItem(
        "camsHandle",
        cams.aaCustomerHandleId || ""
      );

      navigate("/cams");
    } catch (err) {
      setError(
        err.response?.data?.message ||
          "Unable to connect to CAMS backend"
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="logo">C</div>

        <h1 className="title">CAMS Login</h1>

        <p className="subtitle">
          Authenticate with your CAMS FIU account
        </p>

        <form className="login-form" onSubmit={handleLogin}>
          <input
            type="email"
            className="input"
            placeholder="CAMS Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />

          <input
            type="password"
            className="input"
            placeholder="CAMS Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />

          <button
            type="submit"
            className="btn"
            disabled={loading}
          >
            {loading ? "Connecting..." : "Continue to CAMS"}
          </button>

          {error && <p className="error-message">{error}</p>}
        </form>

        <p className="footer-text">
          CAMS UAT • Secure Authentication
        </p>
      </div>
    </div>
  );
}