variable "subscription_id" {
  description = "Azure subscription to deploy into."
  type        = string
}

variable "prefix" {
  description = "Name prefix for every resource."
  type        = string
  default     = "potluck"
}

variable "resource_group_name" {
  description = "Resource group to create."
  type        = string
  default     = "potluck-rg"
}

variable "location" {
  description = "Azure region. eastus and eastus2 both have B-series quota on an Azure for Students subscription."
  type        = string
  default     = "eastus"
}

variable "environment" {
  description = "Tag value only; this stack has one environment."
  type        = string
  default     = "production"
}

variable "vm_size" {
  description = <<-EOT
    B1s is the size Azure for Students covers at 750 hours a month, which is
    24/7 for one machine. Resizing later is a deallocate, a change here, and a
    start — so beginning small costs nothing but a few minutes if 1 GB proves
    too tight.
  EOT
  type        = string
  default     = "Standard_B1s"
}

variable "admin_username" {
  description = "Login for the node. Reachable only through the tunnel."
  type        = string
  default     = "potluck"
}

variable "ssh_public_key" {
  description = "SSH public key contents, e.g. file(\"~/.ssh/id_ed25519.pub\")."
  type        = string
}

variable "cloudflare_tunnel_token" {
  description = <<-EOT
    Token for a Cloudflare Tunnel created in the Zero Trust dashboard. This is
    what lets the node be reachable without a public IP: cloudflared dials out
    and traffic arrives down that connection.
  EOT
  type        = string
  sensitive   = true
}

variable "k3s_version" {
  description = "Pinned so a rebuilt node does not silently land on a different Kubernetes."
  type        = string
  default     = "v1.31.4+k3s1"
}
