# Data Flow

```text
User/Product Goal
      |
      v
Requirements + Project Memory
      |
      v
Architecture + Engineering Plan
      |
      v
Task DAG -----> Code Graph / Memory / Knowledge / World Model
      |
      v
Policy + Risk + Security Preflight
      |
      v
Router -----> Worker Provider
      |             |
      |             v
      |        Isolated Execution
      |             |
      +<------------+
      v
Tests / Review / Security / Quality / Verification
      |
      v
Evidence + Git Checkpoint + Assurance
      |
      +---- failure ---> Recovery ---> Re-verification
      |
      v
Delivery + Observability
      |
      v
Incident / Causal Analysis / Learning
```

Secrets stay at the provider/environment boundary. Evidence stores must contain references and sanitized metadata rather than raw credentials.
