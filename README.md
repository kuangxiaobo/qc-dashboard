# 质检标准系统(静态站点)

自动生成目录,请勿手改内容。

更新流程:
1. 本地 http://localhost:3000 同步北斗数据
2. 运行 `node tools/build-pages.js`
3. `cd qc-pages && git add -A && git commit -m "update data" && git push`
