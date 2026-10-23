# ジュンの野球ノート — 管理と復旧

## 公開と非公開の境界

GitHub Pagesは画面・ソース・Supabase公開キーだけを配信する。記録と家族の所属はSupabaseに保存し、現在の所属をRLSで確認する。家族メール、記録JSON、パスワード、秘密キー、招待・再設定リンクをリポジトリやIssueへ保存しない。

役割は次のとおり。`manager` は閲覧と招待・解除、`writer` は閲覧と記入・編集・削除・達成チェック、`viewer` は閲覧のみ。ノートごとに管理者と記入者はそれぞれ1人。役割を一般APIから変更する権限は付与しない。

## 初期構築

1. 専用の無料プロジェクトを作り、`schema.sql` を一度だけ適用する。既存データへ再実行しない。RLS・権限・関数を同一トランザクションで作成する。
2. Supabase Authで一般登録を無効にし、メールとパスワードのログインを有効にする。Site URLと許可リダイレクトURLは `https://kickerdrops-bot.github.io/jun-baseball-note/` 。メールOTPの有効時間を3600秒にする。
3. `family-admin` をデプロイする。JWTの実検証は関数内の `auth.getUser(jwt)`、家族管理権限は毎回DBの現在の所属で判定する。`verify_jwt=true` も有効にする。
4. 秘密キーは関数の既定環境変数から読む。新形式 `SUPABASE_SECRET_KEYS` の `default` を優先し、旧環境のみ `SUPABASE_SERVICE_ROLE_KEY` へフォールバックする。ブラウザ用にはpublishable keyだけを設定する。
5. 初期管理者はサーバー管理APIの `auth.admin.generateLink({type:'invite',email})` で作成する。選択済み管理者メールを安全な私的入力から渡す。`notebooks` を1行、対応する `memberships` の `manager` を1行、`notebook_documents` を1行（既定値は空配列・更新番号0）作成する。
6. 成功後、返された `properties.hashed_token` から公開URLの `?token_hash=...&type=invite` を構築し、Git管理外の私的な導線で本人へ渡す。本人がパスワードを設定する。管理者メールも初期リンクも公開コードへ入れない。
7. 初期設定に一時関数を使う場合は短い有効期限・十分なランダム性の秘密token・成功後の無効化を必須にする。完了後、一時関数を削除するか全リクエスト拒否へ置き換え、作業用秘密ファイルを削除する。

このアプリはSMTPで招待メールを送らない。管理画面で発行したリンクを対象本人へ手渡す。メールやLINEへ自動送信しない。

## 家族の招待と解除

管理者が管理画面でメールと `writer` / `viewer` を指定する。初回は招待リンク、Authに存在するが現在は家族でないアカウントには再設定リンクを発行して所属を追加する。登録済み家族への再招待は拒否するので「再設定リンク」を使う。既存家族の役割を招待操作で変更することはない。

リンクは一回限りで、有効時間を過ぎたら再発行する。リンクを発行し直すと、以前の未使用リンクが使えなくなる場合がある。受け取り先メールを確認して渡し、利用後はリンク表示を閉じる。

解除では対象の `memberships` だけを削除する。既存JWTが残っていても以後の記録読取・保存は拒否する。すでに端末に表示・書き出し済みの情報を回収する機能はない。Authユーザーの削除は招待と競合し得るため家族管理APIから行わない。管理者自身は解除できない。

管理操作の内部leaseは60秒で失効する。途中で接続が切れた場合、最大60秒待ってから画面更新して再試行する。Authユーザー作成後に失敗しても、所属とリンク返却が完了するまではノートを読めない。再試行時は既存Authアカウントとして安全に復旧できる。

## 管理者自身がログインできないとき

Supabaseプロジェクトの所有者が、サーバーだけで実行する管理APIから `auth.admin.generateLink({type:'recovery',email})` を呼ぶ。`memberships` が現在 `manager` の同じユーザーであることを確認し、返されたhashから `?token_hash=...&type=recovery` を構築して本人へ安全に渡す。管理者の役割を作り直す必要はない。サービス秘密キーをチャット、GitHub、ブラウザへ貼らない。

パスワードを代理で決めたり尋ねたりせず、本人が再設定画面で入力する。管理画面の家族向け再設定機能は管理者を対象にしない。

## 保存とバックアップ

保存は `save_notebook(p_notebook_id,p_expected_revision,p_notes)` だけを使う。更新番号が違う場合は `NOTEBOOK_CONFLICT`、権限不足はSQLSTATE `42501`。画面の内容を消さず、最新状態を確認してから再編集する。ネット接続がない間はクラウド保存できない。

JSONは私的な場所へ定期的に書き出す。旧localhostのデータは自動で移らないので旧画面から書き出し、記入者アカウントでログインして確認付きで取り込む。取り込みの前にも現在の記録を書き出す。保存内容はDBでも型・文字数・重複ID・日付・分類・達成値・関連入力を検証する。旧バックアップ互換のためノート内IDは安全な英数字・`_`・`-`を許容し、新規ノートはUUIDを使う。

## 無料プロジェクトが停止した場合

無料プランでは直近7日間の利用が少ないと一時停止されることがある。アプリが接続できない場合は、Supabase Dashboardで専用プロジェクトを確認し、停止中なら **Resume project** を選ぶ。2026-10-23時点の公式案内では停止から1年以内はDashboardから復旧でき、データと設定が戻る。保存期限を過ぎる前に復旧し、期限やバックアップの利用可否はDashboardの最新表示で確認する。自動で有料プランへ変更しない。

復旧後はログイン、記録表示、記入者の保存、閲覧者の書込拒否を確認する。停止に備えJSONバックアップを別に保持する。

## 検証

`tests/backend-schema-check.sql` は権限・RLS・関数設定を読み取り確認する。Supabase Security Advisor と Performance Advisorも実行し、警告の内容を確認する。

`tests/backend-api.test.mjs` は専用の使い捨てノートと5アカウントだけを操作する。初期fixtureはGit管理外のJSONで渡す。構造は `project_url`, `publishable_key`, `notebook_id`, `accounts: [{role,email,password,user_id}]`。役割は `manager`, `writer`, `viewer`, `uninvited`, `revoked`。`revoked` はテスト開始時には閲覧者として所属し、テスト内で解除する。`uninvited` はAuth登録だけで所属しない。ノートのタイトルは安全確認用の `__JUN_TEST__` にする。

```sh
JUN_BACKEND_FIXTURE=/absolute/private/qa-fixture.json node tests/backend-api.test.mjs
```

実JWTで読取、書込拒否、同時保存、不正JSON、所属改ざん、家族管理拒否、解除後の同JWT拒否を確認する。スクリプトはノートを空にしセッションをログアウトする。実行担当はその後、使い捨てAuthユーザーとノートを管理APIで削除し、私的fixtureも削除する。招待リンクの初回設定・再使用・期限切れ、公開URLのcallback、モバイル表示は別途実操作で検証する。

## 確認した公式資料

- [RLSと明示GRANT](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Data APIの自動公開変更](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically)
- [generateLink](https://supabase.com/docs/reference/javascript/auth-admin-generatelink)
- [トークンhashを使ったverifyOtp](https://supabase.com/docs/guides/auth/auth-email-templates)
- [Edgeの認証ヘッダー](https://supabase.com/docs/guides/functions/auth-headers)
- [Edgeの環境変数](https://supabase.com/docs/guides/functions/secrets)
- [無料プロジェクトの一時停止](https://supabase.com/docs/guides/platform/free-project-pausing)

2026-10-23に変更履歴と関連文書を確認。無料プランのメールテンプレート制限はメール送信をしない本方式に影響しない。TLS更新に備え、利用端末は更新済みのブラウザを使う。
