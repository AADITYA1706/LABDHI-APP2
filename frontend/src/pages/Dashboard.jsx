import { useEffect, useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";

export default function Dashboard() {
  const navigate = useNavigate();

  const [data, setData] = useState({
    accounts: [],
    transactions: [],
    dmat: [],
    insurance: [],
  });

  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");

  const fullname = localStorage.getItem("fullname") || "Employee";

  useEffect(() => {
    const loadDashboard = async () => {
      try {
        const camsData =
          JSON.parse(localStorage.getItem("camsData")) || {};

        const payload = {
          sessionId: camsData.sessionId || "",
          userId: camsData.userId || "",
          consentId:
            localStorage.getItem("consentId") ||
            camsData.consentId ||
            "",
          token:
            localStorage.getItem("camsToken") ||
            camsData.token ||
            "",
          txnId:
            localStorage.getItem("txnId") ||
            camsData.txnId ||
            "",
          aaCustomerHandleId:
            camsData.aaCustomerHandleId || "",
          aaCustomerMobile:
            camsData.aaCustomerMobile || "",
        };

        const res = await axios.post(
          "/api/auth/dashboard-data",
          payload
        );

        const api = res.data?.data || {};

        setData({
          accounts: api.accounts || [],
          transactions: api.transactions || [],
          dmat: api.dmat || [],
          insurance: api.insurance || [],
        });
      } catch (err) {
        setError(
          err.response?.data?.message ||
            "Unable to load CAMS dashboard data"
        );
      } finally {
        setLoading(false);
      }
    };

    loadDashboard();
  }, []);

  const checkConsent = async () => {
    try {
      setChecking(true);

      const sessionId = localStorage.getItem("sessionId");
      const consentHandle =
        localStorage.getItem("consentHandle");
      const token = localStorage.getItem("camsToken");

      const res = await axios.post(
        "/api/cams/status",
        {
          sessionId,
          consentHandle,
          token,
          txnId: localStorage.getItem("txnId"),
          userId: localStorage.getItem("employeeEmail"),
        }
      );

      if (res.data.success && res.data.consentStatus === "ACTIVE" && res.data.consentId) {
        localStorage.setItem(
          "consentId",
          res.data.consentId
        );
        localStorage.setItem("sessionId", res.data.sessionId || sessionId);
        localStorage.setItem("txnId", res.data.txnId || localStorage.getItem("txnId") || "");

        navigate("/banking");
      } else {
        setError(
          res.data.message ||
            `Consent status: ${res.data.consentStatus || "PENDING"}`
        );
      }
    } catch (err) {
      setError(
        err.response?.data?.message ||
          "Unable to verify consent"
      );
    } finally {
      setChecking(false);
    }
  };

  const totalBalance = data.accounts.reduce(
    (sum, acc) => sum + Number(acc.balance || 0),
    0
  );

  const monthlyIncome = data.transactions
    .filter((t) => Number(t.amount) > 0)
    .reduce((sum, t) => sum + Number(t.amount), 0);

  if (loading) {
    return (
      <div className="page-stack">
        <div className="loading-box">
          Loading Dashboard...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-stack">
        <div className="loading-box">
          <strong>Dashboard unavailable</strong>
          <p>{error}</p>
          <button className="btn" onClick={() => window.location.reload()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page-stack">

      <div className="page-header">
        <div>
          <h1>Labdhi Banking Dashboard</h1>
          <p>Welcome, {fullname}</p>
        </div>

        <button
          className="btn"
          onClick={checkConsent}
          disabled={checking}
        >
          {checking
            ? "Checking..."
            : "Check Consent & Continue"}
        </button>
      </div>

      <div className="stats-grid">
        <div className="stat-card accent">
          <span>Total Balance</span>
          <strong>
            ₹ {totalBalance.toLocaleString("en-IN")}
          </strong>
          <small>Across linked accounts</small>
        </div>

        <div className="stat-card">
          <span>Monthly Income</span>
          <strong>
            ₹ {monthlyIncome.toLocaleString("en-IN")}
          </strong>
          <small>Credits</small>
        </div>

        <div className="stat-card">
          <span>Linked Accounts</span>
          <strong>{data.accounts.length}</strong>
          <small>Bank Accounts</small>
        </div>
      </div>

      <section className="panel">
        <div className="panel-header">
          <h3>Bank Accounts</h3>
        </div>

        <div className="account-grid">
          {data.accounts.length === 0 ? (
            <div className="account-card">
              No Accounts Found
            </div>
          ) : (
            data.accounts.map((acc, i) => (
              <div
                key={i}
                className="account-card"
              >
                <strong>{acc.bankName}</strong>
                <small>{acc.accountNumber}</small>

                <h2>
                  ₹{" "}
                  {Number(
                    acc.balance
                  ).toLocaleString("en-IN")}
                </h2>

                <span>{acc.accountType}</span>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h3>Recent Transactions</h3>
        </div>

        <ul className="transaction-list">
          {data.transactions.length === 0 ? (
            <li>No Transactions</li>
          ) : (
            data.transactions.map((tx, i) => (
              <li key={i}>
                <div>
                  <strong>{tx.title}</strong>
                  <small>{tx.date}</small>
                </div>

                <span
                  className={
                    Number(tx.amount) >= 0
                      ? "credit"
                      : "debit"
                  }
                >
                  ₹{" "}
                  {Number(
                    tx.amount
                  ).toLocaleString("en-IN")}
                </span>
              </li>
            ))
          )}
        </ul>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h3>DMAT Holdings</h3>
        </div>

        <div className="account-grid">
          {data.dmat.length === 0 ? (
            <div className="account-card">
              No Holdings
            </div>
          ) : (
            data.dmat.map((item, i) => (
              <div
                key={i}
                className="account-card"
              >
                <strong>{item.securityName}</strong>

                <h2>
                  ₹{" "}
                  {Number(
                    item.currentValue
                  ).toLocaleString("en-IN")}
                </h2>

                <small>
                  Qty : {item.quantity}
                </small>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h3>Insurance</h3>
        </div>

        <div className="account-grid">
          {data.insurance.length === 0 ? (
            <div className="account-card">
              No Insurance
            </div>
          ) : (
            data.insurance.map((p, i) => (
              <div
                key={i}
                className="account-card"
              >
                <strong>{p.policyName}</strong>

                <h2>
                  ₹{" "}
                  {Number(
                    p.coverage
                  ).toLocaleString("en-IN")}
                </h2>

                <small>
                  Premium : ₹ {p.premium}
                </small>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}