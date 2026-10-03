
import { useEffect, useState } from "react";
import axios from "axios";

export default function Banking() {
  const [portfolio, setPortfolio] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadPortfolio = async () => {
      try {
        const sessionId = localStorage.getItem("sessionId");
        const consentId = localStorage.getItem("consentId");
        const txnId = localStorage.getItem("txnId");

        const res = await axios.post(
          "/api/cams/fetch",
          {
            sessionId,
            consentId,
            txnId,
          }
        );

        setPortfolio(res.data.portfolio);

        const bankAccounts =
          res.data.portfolio?.accounts ||
          res.data.portfolio?.bankAccounts ||
          [];

        setAccounts(bankAccounts);
      } catch (err) {
        console.error(err);
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
            <h3>{acc.bank}</h3>
            <p>{acc.type}</p>

            <h2 style={{ color: "#0A5ADF" }}>
              ₹{Number(acc.balance || 0).toLocaleString("en-IN")}
            </h2>

            <small>
              A/C : {acc.accountNumber || "XXXXXXXXXX"}
            </small>
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
                <td style={{ padding: 12 }}>{acc.bank}</td>
                <td>{acc.accountNumber || "-"}</td>
                <td>{acc.type}</td>
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
