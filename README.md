# talos-deploy

## 发布

```bash
npm run release           # patch bump (0.0.3 → 0.0.4)
npm run release -- minor  # minor bump
npm run release -- major  # major bump
```

脚本会自动：bump 版本 → 同步 lockfile → commit → 打 annotated tag `cli-v*` → push 触发 GitHub Actions 发布。
