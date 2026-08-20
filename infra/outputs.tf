output "resource_group" {
  description = "Resource group holding everything, so `az group delete` tears the lot down."
  value       = azurerm_resource_group.potluck.name
}

output "vm_name" {
  value = azurerm_linux_virtual_machine.potluck.name
}

output "private_ip" {
  description = "The node has no public address by design; this is reachable only inside the VNet or through the tunnel."
  value       = azurerm_network_interface.potluck.private_ip_address
}

output "serial_console_hint" {
  description = "The way back in if the tunnel itself is broken."
  value       = "az serial-console connect -n ${azurerm_linux_virtual_machine.potluck.name} -g ${azurerm_resource_group.potluck.name}"
}

output "estimated_monthly_usd" {
  description = <<-EOT
    Rough, and the number that matters. A B1s is about $7.59/month at list
    price; Azure for Students covers 750 hours of it, and the $100 credit covers
    roughly a year if it does not. No public IP, no load balancer and no managed
    disk beyond the OS disk, which is where the rest of the bill would otherwise
    come from.
  EOT
  value       = "~7.59 (B1s) + ~1.50 (30GB Standard_LRS os disk)"
}
