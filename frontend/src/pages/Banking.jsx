
import { useEffect, useState } from "react";
import axios from "axios";

export default function Banking() {
  const [portfolio, setPortfolio] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const loadPortfolio = async () => {
      try {
        const camsData = JSON.parse(localStorage.getItem("camsData") || "{}");

        const res = await axios.post(
          "/api/auth/dashboard-data",
          {
            sessionId: camsData.sessionId || localStorage.getItem("sessionId") || "",
            consentId: localStorage.getItem("consentId") || camsData.consentId || "",
            consentHandle: localStorage.getItem("consentHandle") || camsData.consentHandle || "",
            txnId: localStorage.getItem("txnId") || camsData.txnId || "",
          }
        );

        const data = res.data?.data || {};
        const fetchedPortfolio = data.portfolio || data;
        setPortfolio(fetchedPortfolio);
        setAccounts(Array.isArray(data.accounts) ? data.accounts : []);
        setTransactions(Array.isArray(data.transactions) ? data.transactions : []);
      } catch (err) {
        console.error(err);
        setError(err.response?.data?.message || "Unable to load CAMS banking data");
      } finally {
        setLoading(false);
      }
    };

    loadPortfolio();
  }, []);

  if (loading) {
    return (
      <div style={{ padding: 40 }}>
        <h2>Loading Banking Data...</h2>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 40 }} role="alert">
        <h2>Banking data unavailable</h2>
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div
      style={{
        padding: 30,
        background: "#f5f7fb",
        minHeight: "100vh",
      }}
    >
      <h1 style={{ color: "#0A5ADF" }}>Labdhi Banking Dashboard</h1>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))",
          gap: 20,
          marginTop: 25,
        }}
      >
        {accounts.map((acc, i) => (
          <div
            key={i}
            style={{
              background: "#fff",
              borderRadius: 12,
              padding: 20,
              boxShadow: "0 5px 15px rgba(0,0,0,.08)",
            }}
          >
            <h3>{acc.bankName || acc.bank || "Bank account"}</h3>
            <p>{acc.accountType || acc.type || ""}</p>

            <h2 style={{ color: "#0A5ADF" }}>
              ₹{Number(acc.balance || 0).toLocaleString("en-IN")}
            </h2>

            <small>A/C : {acc.accountNumber || "Not provided"}</small>
          </div>
        ))}
      </div>

      <div
        style={{
          background: "#fff",
          marginTop: 35,
          borderRadius: 12,
          padding: 20,
        }}
      >
        <h2>All Bank Accounts</h2>

        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            marginTop: 15,
          }}
        >
          <thead>
            <tr style={{ background: "#0A5ADF", color: "#fff" }}>
              <th style={{ padding: 12 }}>Bank</th>
              <th>Account</th>
              <th>Type</th>
              <th>Balance</th>
            </tr>
          </thead>

          <tbody>
            {accounts.map((acc, i) => (
              <tr key={i}>
                <td style={{ padding: 12 }}>{acc.bankName || acc.bank || "Bank account"}</td>
                <td>{acc.accountNumber || "-"}</td>
                <td>{acc.accountType || acc.type || "-"}</td>
                <td>
                  ₹{Number(acc.balance || 0).toLocaleString("en-IN")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div
        style={{
          background: "#fff",
          marginTop: 30,
          borderRadius: 12,
          padding: 20,
        }}
      >
        <h2>Transactions</h2>
        {transactions.length === 0 ? (
          <p>No transactions were returned by CAMS.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 15 }}>
            <thead>
              <tr style={{ background: "#0A5ADF", color: "#fff" }}>
                <th style={{ padding: 12, textAlign: "left" }}>Description</th>
                <th style={{ textAlign: "left" }}>Date</th>
                <th style={{ textAlign: "right" }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((transaction, index) => (
                <tr key={`${transaction.date}-${index}`}>
                  <td style={{ padding: 12 }}>{transaction.title || "Transaction"}</td>
                  <td>{transaction.date || "-"}</td>
                  <td style={{ textAlign: "right" }}>
                    {transaction.amount === null || transaction.amount === undefined
                      ? "Not provided"
                      : `₹${Number(transaction.amount).toLocaleString("en-IN")}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div
        style={{
          background: "#fff",
          marginTop: 30,
          borderRadius: 12,
          padding: 20,
        }}
      >
        <h2>Raw Portfolio (Debug)</h2>

        <pre
          style={{
            whiteSpace: "pre-wrap",
            fontSize: 12,
          }}
        >
          {JSON.stringify(portfolio, null, 2)}
        </pre>
      </div>
    </div>
  );
}
