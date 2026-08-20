# Infrastructure

One Azure VM running single-node k3s, reachable only through a Cloudflare
Tunnel. No public IP, no load balancer, no inbound firewall rule.

## Why it looks like this

The constraint is that this project costs nothing. Azure for Students covers a
B1s at 750 hours a month — 24/7 for one machine — and gives $100 of credit
without a card. Everything here is shaped by staying inside that.

The absent pieces are the interesting ones:

- **No public IP.** Azure charges per static IP, and an exposed SSH port is the
  single most attacked thing on the internet. The node dials out to Cloudflare
  instead; traffic arrives down that connection. SSH goes the same way.
- **No load balancer.** One replica, fifteen users. A load balancer would cost
  more than the VM it fronts.
- **No managed Kubernetes.** AKS's control plane is free but its node pool needs
  a minimum size that costs about $30/month. k3s on a B1s is $0 and teaches more.

## First run

```bash
cp terraform.tfvars.example terraform.tfvars   # then fill it in
terraform init
terraform plan
terraform apply
```

Then point the tunnel's public hostname at `http://potluck.default.svc:80` in
the Cloudflare Zero Trust dashboard, and install the chart:

```bash
helm upgrade --install potluck ../charts/potluck \
  --set image.tag=<sha> \
  --set tunnel.enabled=true \
  --set env.APP_URL=https://<your-hostname>
```

Secrets are created out of band so no credential passes through a values file:

```bash
kubectl create secret generic potluck-secrets \
  --from-literal=databaseUrl='postgres://...' \
  --from-literal=authSecret="$(openssl rand -base64 32)" \
  --from-literal=groqApiKey='gsk_...'
```

## If it breaks

The tunnel is a host service, not a pod, so it survives the cluster being
unhealthy — which is when you need it. If the tunnel itself is down:

```bash
az serial-console connect -n potluck-node -g potluck-rg
```

## When the Azure runway ends

Around month twelve the credit or the free-services allowance runs out. Nothing
here is load-bearing for the application: the same Helm chart deploys to any
cluster, and Render is configured as a standby that runs the same image. The
move is a Helm release and a DNS change, not a migration.

Tear down with `terraform destroy`, or `az group delete -n potluck-rg` if
Terraform state has been lost.
