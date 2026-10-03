import { useEffect, useState } from "react";
import axios from "axios";

export default function Insurance() {
  const [policies, setPolicies] = useState([]);
  const [supported, setSupported] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    axios
      .get("/api/insurance")
      .then((res) => {
        if (active) {
          setSupported(res.data?.supported === true);
          setPolicies(Array.isArray(res.data?.policies) ? res.data.policies : []);
        }
      })
      .catch((err) => {
        console.error(err);
        if (active) {
          setError(err.response?.data?.message || "Unable to check insurance API availability.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <div style={{ padding: "30px" }}>
      <h1>Insurance Policies</h1>

      {loading && <p role="status">Loading insurance data...</p>}
      {error && <p role="alert">{error}</p>}
      {!loading && !error && !supported && (
        <p role="status">
          Insurance data is not supported by the configured CAMS API.
        </p>
      )}

      {policies.map((p, i) => (
        <div
          key={i}
          style={{
            background: "#fff",
            padding: "18px",
            borderRadius: "12px",
            marginTop: "15px",
            boxShadow: "0 4px 12px rgba(0,0,0,.08)"
          }}
        >
          <h3>{p.name}</h3>

          <p>Coverage: {p.coverage}</p>
          <p>Premium: ₹{Number(p.premium || 0).toLocaleString()}</p>

          <span
            style={{
              color: p.status === "Active" ? "green" : "orange",
              fontWeight: "bold"
            }}
          >
            {p.status}
          </span>
        </div>
      ))}
    </div>
  );
}