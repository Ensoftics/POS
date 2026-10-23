#!/bin/sh
# Prepares a fresh Ubuntu 22.04/24.04 server (e.g. Oracle Cloud Always Free) for Ensoftic POS:
# Docker Engine + Compose, the firewall opened for web traffic only, and automatic security updates.
#   sudo sh infra/deploy/setup-server.sh
set -eu
[ "$(id -u)" = "0" ] || { echo "Run with sudo." >&2; exit 1; }

apt-get update
apt-get install -y ca-certificates curl git unattended-upgrades
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
. /etc/os-release
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
[ -n "${SUDO_USER:-}" ] && usermod -aG docker "$SUDO_USER"

# Oracle's Ubuntu images block everything except SSH in iptables (in addition to the cloud
# firewall): allow web traffic and keep the rule after reboots.
if command -v iptables >/dev/null && iptables -L INPUT -n | grep -q REJECT; then
  for port in 80 443; do
    iptables -C INPUT -p tcp --dport "$port" -m state --state NEW -j ACCEPT 2>/dev/null ||
      iptables -I INPUT 5 -p tcp --dport "$port" -m state --state NEW -j ACCEPT
  done
  apt-get install -y iptables-persistent
  netfilter-persistent save
fi

dpkg-reconfigure -f noninteractive unattended-upgrades
echo "Server ready. Log out and back in once so '${SUDO_USER:-your user}' can use docker without sudo."
