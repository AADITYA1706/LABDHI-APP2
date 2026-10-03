import { useEffect, useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  AlertTriangle,
  Banknote,
  Building2,
  ChartNoAxesCombined,
  FileText,
  Landmark,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import {
  getCamsConsentId,
  isCamsConsentActive,
} from "./camsStatus.js";

const formatCurrency = (amount) => {
  if (amount === null || amount === undefined || amount === "") {
    return "Not available";
  }

  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number(amount) || 0);
};

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
  const [warning, setWarning] = useState("");
  const [retryAfter, setRetryAfter] = useState("");

  const fullname = localStorage.getItem("fullname") || "Employee";
  const firstName = fullname.trim().split(/\s+/)[0] || "there";

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
          txnId:
            localStorage.getItem("txnId") ||
            camsData.txnId ||
            "",
          aaCustomerHandleId:
            camsData.aaCustomerHandleId || "",
          aaCustomerMobile:
            camsData.aaCustomerMobile || "",
          consentHandle:
            localStorage.getItem("consentHandle") || camsData.consentHandle || "",
        };

        const res = await axios.post(
          "/api/auth/dashboard-data",
          payload
        );

        const api = res.data?.data || {};

        setData({
          accounts: Array.isArray(api.accounts) ? api.accounts : [],
          transactions: Array.isArray(api.transactions) ? api.transactions : [],
          dmat: Array.isArray(api.dmat) ? api.dmat : [],
          insurance: Array.isArray(api.insurance) ? api.insurance : [],
        });
        setWarning(res.data?.warning || "");
        setRetryAfter(res.data?.retryAfter || "");
        if (api.portfolio && typeof api.portfolio === "object") {
          localStorage.setItem("camsPortfolio", JSON.stringify(api.portfolio));
        }
        if (res.data?.consentId) {
          localStorage.setItem("consentId", res.data.consentId);
        }
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

      const res = await axios.post(
        "/api/cams/status",
        {
          sessionId,
          consentHandle,
          txnId: localStorage.getItem("txnId"),
          userId: localStorage.getItem("employeeEmail"),
        }
      );

      const consentId = getCamsConsentId(res.data);
      if (
        res.data.success &&
        isCamsConsentActive(res.data, consentId) &&
        consentId
      ) {
        localStorage.setItem(
          "consentId",
          consentId
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

  const accountsWithBalance = data.accounts.filter(
    (account) => account.balance !== null && account.balance !== undefined && Number.isFinite(Number(account.balance))
  );
  const totalBalance = accountsWithBalance.length
    ? accountsWithBalance.reduce((sum, account) => sum + Number(account.balance), 0)
    : data.accounts.length === 0
      ? 0
      : null;

  const monthlyIncome = data.transactions
    .filter((t) => Number(t.amount) > 0)
    .reduce((sum, t) => sum + Number(t.amount), 0);

  if (loading) {
    return (
      <div className="page-stack">
        <div className="loading-box" role="status">
          <span className="loading-indicator" aria-hidden="true" />
          <span>Loading your finance overview...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-stack">
        <div className="dashboard-error">
          <strong>Dashboard unavailable</strong>
          <p>{error}</p>
          <button className="primary-button" onClick={() => window.location.reload()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page-stack">
      <section className="welcome-row">
        <div className="welcome-copy">
          <p className="section-kicker">YOUR FINANCE OVERVIEW</p>
          <h1>Welcome back, {firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase()}</h1>
          <p className="welcome-subtitle">
            A clear view of your connected accounts and financial activity.
          </p>
        </div>

        <button
          className="consent-action"
          onClick={checkConsent}
          disabled={checking}
        >
          <span className="consent-icon"><ShieldCheck size={21} /></span>
          <span className="consent-copy">
            <strong>{checking ? "Checking consent..." : "Check Consent & Continue"}</strong>
            <small>Verify your CAMS connection</small>
          </span>
          <ArrowRight className="consent-arrow" size={19} />
        </button>
      </section>

      {warning && (
        <div className="dashboard-warning" role="status">
          <AlertTriangle size={18} />
          <span>
            {warning}
            {retryAfter && ` Another fetch is allowed after ${new Date(retryAfter).toLocaleDateString("en-IN")}.`}
          </span>
        </div>
      )}

      <div className="stats-grid">
        <article className="stat-card">
          <div className="stat-heading">
            <span>Total Balance</span>
            <span className="stat-icon balance-icon"><Wallet size={19} /></span>
          </div>
          <strong className="stat-value">{formatCurrency(totalBalance)}</strong>
          <small>Across linked accounts</small>
          <span className="stat-accent" />
        </article>

        <article className="stat-card">
          <div className="stat-heading">
            <span>Monthly Income</span>
            <span className="stat-icon income-icon"><ArrowDownLeft size={19} /></span>
          </div>
          <strong className="stat-value">{formatCurrency(monthlyIncome)}</strong>
          <small>Credits this month</small>
          <span className="stat-accent income-accent" />
        </article>

        <article className="stat-card">
          <div className="stat-heading">
            <span>Linked Accounts</span>
            <span className="stat-icon accounts-icon"><Landmark size={19} /></span>
          </div>
          <strong className="stat-value">{data.accounts.length}</strong>
          <small>Bank accounts connected</small>
          <span className="stat-accent accounts-accent" />
        </article>
      </div>

      <section className="dashboard-section">
        <div className="section-heading">
          <div className="section-title-wrap">
            <span className="section-icon"><Building2 size={19} /></span>
            <div>
              <h2>Bank Accounts</h2>
              <p>Your connected accounts at a glance</p>
            </div>
          </div>
          <button className="text-link" onClick={() => navigate("/banking")}>
            View all <ArrowRight size={16} />
          </button>
        </div>

        <div className="account-grid">
          {data.accounts.length === 0 ? (
            <div className="empty-state">
              <span className="empty-icon"><Landmark size={21} /></span>
              <strong>No accounts found</strong>
              <p>Complete consent to securely connect your bank accounts.</p>
            </div>
          ) : (
            data.accounts.map((acc, i) => (
              <article key={i} className="account-card">
                <div className="account-card-top">
                  <span className="account-bank-icon"><Landmark size={19} /></span>
                  <span className="account-type">{acc.accountType || "Bank account"}</span>
                </div>
                <strong className="account-bank-name">{acc.bankName || "Bank account"}</strong>
                <small className="account-number">{acc.accountNumber || "Account details unavailable"}</small>
                <span className="account-balance-label">Available balance</span>
                <strong className="account-balance">{formatCurrency(acc.balance)}</strong>
              </article>
            ))
          )}
        </div>
      </section>

      <div className="dashboard-content-grid">
        <section className="dashboard-section transactions-section">
          <div className="section-heading">
            <div className="section-title-wrap">
              <span className="section-icon"><ChartNoAxesCombined size={19} /></span>
              <div>
                <h2>Recent Transactions</h2>
                <p>A snapshot of your latest activity</p>
              </div>
            </div>
          </div>

          {data.transactions.length === 0 ? (
            <div className="empty-state compact-empty">
              <span className="empty-icon"><ArrowRight size={20} /></span>
              <strong>No transactions yet</strong>
              <p>Your account activity will appear here.</p>
            </div>
          ) : (
            <ul className="transaction-list">
              {data.transactions.map((tx, i) => (
                <li key={i}>
                  <span className={`transaction-icon ${Number(tx.amount) >= 0 ? "transaction-credit" : "transaction-debit"}`}>
                    {Number(tx.amount) >= 0 ? <ArrowDownLeft size={18} /> : <ArrowUpRight size={18} />}
                  </span>
                  <span className="transaction-copy">
                    <strong>{tx.title || "Account transaction"}</strong>
                    <small>{tx.date || "Date unavailable"}</small>
                  </span>
                  <strong className={Number(tx.amount) >= 0 ? "credit" : "debit"}>
                    {tx.amount === null || tx.amount === undefined
                      ? "Amount unavailable"
                      : formatCurrency(Math.abs(Number(tx.amount)))}
                  </strong>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="dashboard-section">
          <div className="section-heading">
            <div className="section-title-wrap">
              <span className="section-icon holdings-icon"><Banknote size={19} /></span>
              <div>
                <h2>DMAT Holdings</h2>
                <p>Your investment portfolio</p>
              </div>
            </div>
          </div>

          {data.dmat.length === 0 ? (
            <div className="empty-state compact-empty">
              <span className="empty-icon"><ChartNoAxesCombined size={20} /></span>
              <strong>No holdings found</strong>
              <p>Your investment holdings will appear here.</p>
            </div>
          ) : (
            <div className="holding-list">
              {data.dmat.map((item, i) => (
                <article key={i} className="holding-row">
                  <span className="holding-symbol"><Banknote size={18} /></span>
                  <span className="holding-copy">
                    <strong>{item.securityName || "Security"}</strong>
                    <small>Quantity: {item.quantity ?? "—"}</small>
                  </span>
                  <strong>{formatCurrency(item.currentValue)}</strong>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="dashboard-section insurance-section">
          <div className="section-heading">
            <div className="section-title-wrap">
              <span className="section-icon insurance-icon"><ShieldCheck size={19} /></span>
              <div>
                <h2>Insurance</h2>
                <p>Coverage linked to your profile</p>
              </div>
            </div>
            <FileText className="section-trailing-icon" size={18} />
          </div>

          {data.insurance.length === 0 ? (
            <div className="empty-state compact-empty">
              <span className="empty-icon"><ShieldCheck size={20} /></span>
              <strong>No insurance policies</strong>
              <p>Your linked policies will appear here.</p>
            </div>
          ) : (
            <div className="policy-grid">
              {data.insurance.map((policy, i) => (
                <article key={i} className="policy-card">
                  <span className="policy-label">{policy.status || "Policy"}</span>
                  <strong>{policy.policyName || "Insurance policy"}</strong>
                  <span className="policy-coverage">Coverage {formatCurrency(policy.coverage)}</span>
                  <small>Premium {formatCurrency(policy.premium)}</small>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}