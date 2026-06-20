use meval::Expr;
use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum CalcError {
    #[error("invalid expression: {0}")]
    InvalidExpression(String),
    #[error("evaluation error: {0}")]
    EvalError(String),
}

impl Serialize for CalcError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

#[derive(Serialize)]
pub struct CalcResult {
    pub expression: String,
    pub result: String,
}

#[tauri::command]
pub fn evaluate_expression(expression: String) -> Result<CalcResult, CalcError> {
    if expression.trim().is_empty() {
        return Err(CalcError::InvalidExpression("empty expression".into()));
    }
    let expr: Expr = expression
        .parse()
        .map_err(|e: meval::Error| CalcError::InvalidExpression(e.to_string()))?;
    let value = expr
        .eval()
        .map_err(|e: meval::Error| CalcError::EvalError(e.to_string()))?;
    Ok(CalcResult {
        expression: expression.trim().into(),
        result: format!("{}", value),
    })
}
