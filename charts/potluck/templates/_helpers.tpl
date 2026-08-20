{{- define "potluck.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Fully-qualified name.

The `contains` check is the standard Helm idiom and it earns its keep: without
it, a release named "potluck" of a chart named "potluck" produces
"potluck-potluck", and every reference to the Service by its expected name —
including the CI smoke test's port-forward — quietly points at nothing.
*/}}
{{- define "potluck.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := include "potluck.name" . -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "potluck.labels" -}}
app.kubernetes.io/name: {{ include "potluck.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "potluck.image" -}}
{{ .Values.image.repository }}:{{ .Values.image.tag | default .Chart.AppVersion }}
{{- end -}}

{{/*
Environment shared by the API, the worker and the migration job.

Every secret is a secretKeyRef rather than a literal, so `helm get values` and
`kubectl describe` never print a credential, and rotating one is a Secret edit
rather than a redeploy.
*/}}
{{- define "potluck.env" -}}
- name: NODE_ENV
  value: {{ .Values.env.NODE_ENV | quote }}
- name: APP_URL
  value: {{ .Values.env.APP_URL | quote }}
- name: API_PORT
  value: {{ .Values.service.targetPort | quote }}
- name: DATABASE_URL
  valueFrom:
    secretKeyRef:
      name: {{ .Values.secrets.name }}
      key: databaseUrl
- name: AUTH_SECRET
  valueFrom:
    secretKeyRef:
      name: {{ .Values.secrets.name }}
      key: authSecret
- name: GROQ_API_KEY
  valueFrom:
    secretKeyRef:
      name: {{ .Values.secrets.name }}
      key: groqApiKey
      optional: true
{{- end -}}
