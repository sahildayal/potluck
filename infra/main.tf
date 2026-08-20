terraform {
  required_version = ">= 1.6"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
  }
}

provider "azurerm" {
  features {}
  subscription_id = var.subscription_id
}

# =============================================================================
# Potluck — a single Azure VM running k3s
# =============================================================================
# Sized to what Azure for Students actually provides: a B1s, 1 vCPU and 1 GB of
# RAM, at 750 hours a month. That is 24/7 for one machine, which is exactly one
# machine's worth of Potluck.
#
# The notable thing about this file is what is absent. There is no public IP, no
# load balancer, and no inbound security rule. The node dials OUT to Cloudflare
# and all traffic — including SSH — arrives down that tunnel. Nothing on the
# internet can reach the VM directly, Azure's per-IP charge never applies, and
# the attack surface is a process making outbound TLS connections.
# =============================================================================

resource "azurerm_resource_group" "potluck" {
  name     = var.resource_group_name
  location = var.location
  tags     = local.tags
}

resource "azurerm_virtual_network" "potluck" {
  name                = "${var.prefix}-vnet"
  address_space       = ["10.20.0.0/16"]
  location            = azurerm_resource_group.potluck.location
  resource_group_name = azurerm_resource_group.potluck.name
  tags                = local.tags
}

resource "azurerm_subnet" "nodes" {
  name                 = "${var.prefix}-nodes"
  resource_group_name  = azurerm_resource_group.potluck.name
  virtual_network_name = azurerm_virtual_network.potluck.name
  address_prefixes     = ["10.20.1.0/24"]
}

# Deny-by-default. Azure permits outbound by default, which is all the tunnel
# needs; the explicit inbound deny makes the intent obvious to anyone reading
# this later and stops a future "just open 22 for a minute" from being quiet.
resource "azurerm_network_security_group" "potluck" {
  name                = "${var.prefix}-nsg"
  location            = azurerm_resource_group.potluck.location
  resource_group_name = azurerm_resource_group.potluck.name
  tags                = local.tags

  security_rule {
    name                       = "deny-all-inbound"
    priority                   = 4096
    direction                  = "Inbound"
    access                     = "Deny"
    protocol                   = "*"
    source_port_range          = "*"
    destination_port_range     = "*"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }
}

resource "azurerm_network_interface" "potluck" {
  name                = "${var.prefix}-nic"
  location            = azurerm_resource_group.potluck.location
  resource_group_name = azurerm_resource_group.potluck.name
  tags                = local.tags

  ip_configuration {
    name                          = "internal"
    subnet_id                     = azurerm_subnet.nodes.id
    private_ip_address_allocation = "Dynamic"
    # No public_ip_address_id. This is deliberate and load-bearing.
  }
}

resource "azurerm_network_interface_security_group_association" "potluck" {
  network_interface_id      = azurerm_network_interface.potluck.id
  network_security_group_id = azurerm_network_security_group.potluck.id
}

resource "azurerm_linux_virtual_machine" "potluck" {
  name                = "${var.prefix}-node"
  resource_group_name = azurerm_resource_group.potluck.name
  location            = azurerm_resource_group.potluck.location
  size                = var.vm_size
  admin_username      = var.admin_username
  tags                = local.tags

  network_interface_ids = [azurerm_network_interface.potluck.id]

  # Password authentication is disabled outright. The only way in is through the
  # tunnel, and the only credential is the SSH key.
  disable_password_authentication = true

  admin_ssh_key {
    username   = var.admin_username
    public_key = var.ssh_public_key
  }

  os_disk {
    caching = "ReadWrite"
    # Standard_LRS rather than Premium: a B1s cannot use premium storage, and
    # the workload is a handful of containers reading from a remote database.
    storage_account_type = "Standard_LRS"
    disk_size_gb         = 30
  }

  source_image_reference {
    publisher = "Canonical"
    offer     = "ubuntu-24_04-lts"
    sku       = "server"
    version   = "latest"
  }

  # Boot diagnostics with a managed storage account gives serial console access,
  # which is the way back in if the tunnel itself is ever broken.
  boot_diagnostics {}

  custom_data = base64encode(templatefile("${path.module}/cloud-init.yaml", {
    tunnel_token = var.cloudflare_tunnel_token
    k3s_version  = var.k3s_version
  }))

  lifecycle {
    # The image publishes a new "latest" regularly; rebuilding the node on every
    # plan because of that would be absurd. Rebuild deliberately instead.
    ignore_changes = [source_image_reference[0].version]
  }
}

locals {
  tags = {
    project     = "potluck"
    managed_by  = "terraform"
    environment = var.environment
  }
}
