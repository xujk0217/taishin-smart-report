# Current System Reference

This is the sole engineering reference for the currently deployed Stage 2 planner.

- Input: up to 20 Excel files plus a natural-language prompt.
- Runtime: Cognito, API Gateway, private S3 uploads, DynamoDB jobs, Step Functions, ECS Fargate, Amazon Bedrock and CloudWatch safe logs in `us-east-1`.
- Planner stages: requirements -> formula -> calculation -> composition -> prompt-alignment.
- Current terminal state: `NEEDS_REVIEW` exposes a user-reviewable plan. Calculation execution, PPTX rendering, artifacts, research and email remain disabled / mock by design.
- Validation: schemas, actual workbook bindings, formula-variable matching, chart links, page/reference invariants, and an independent original-prompt coverage check.
- Latest live smoke test: a real Excel upload completed all stages, reached `NEEDS_REVIEW`, and returned prompt-alignment score 97 with approval true.

Do not treat legacy Kiro or AIDLC specifications as current requirements. They are ignored by Git and are pending an explicitly approved permanent deletion because they contain abandoned alternatives and domain-specific assumptions.
