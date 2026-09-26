# Load tests (k6)

These tests measure read-only public endpoints. They do not create users, submit exams, upload files, or change production data.

## Before running

1. Run the backend and point `BASE_URL` to a **staging** deployment with production-like PostgreSQL, Redis, indexes, and storage configuration.
2. Install [k6](https://grafana.com/docs/k6/latest/set-up/install-k6/).
3. Start small, observe the CPU, RAM, database connections, Redis, and error rate, then increase gradually.

```powershell
cd Backend
$env:BASE_URL = 'https://staging-api.example.com/api/v1'
$env:VUS = '20'
k6 run load-tests/smoke.js
```

## Passing baseline

The script fails when more than 1% of requests fail or the 95th-percentile response time exceeds 1 second. This is a starting SLO, not a claim about final capacity. Repeat the test at 20, 50, 100, and then higher virtual users while watching infrastructure metrics.

Never load-test the live production site without a planned window, observability, rate-limit review, and a rollback contact. A load test intentionally creates many requests and can affect real students.
