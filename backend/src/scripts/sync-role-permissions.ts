import { syncRolePermissions } from "../shared/sync-role-permissions.js";
import { prisma } from "../shared/prisma.js";

async function main() {
  await syncRolePermissions();
  console.log("角色权限同步完成。");
}

main()
  .catch((error) => {
    console.error("角色权限同步失败", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
