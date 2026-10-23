"""Table Designer Service: DDL generation and Diff migration engine.
Supports SQL Server and PostgreSQL.
"""
from typing import Any, Dict, List

from app.database.sql_utils import quote_ident, quote_qualified, escape_literal


class TableDesignerService:

    @staticmethod
    def _quote_ident(name: str, engine: str) -> str:
        """Wrapper around centralized sql_utils.quote_ident for backward compatibility."""
        return quote_ident(name, engine)

    @staticmethod
    def _format_table_name(schema: str, table: str, engine: str) -> str:
        """Formats schema.table using centralized quote_qualified."""
        eng = (engine or "").lower()
        if eng in ("sqlite", "sqlite3"):
            if schema and schema.lower() != "main":
                return quote_qualified(schema, table, engine=engine)
            return quote_ident(table, engine=engine)
        s = schema or ("public" if eng == "postgresql" else "dbo")
        return quote_qualified(s, table, engine=engine)


    @classmethod
    def format_column_type(cls, col: Dict[str, Any], engine: str) -> str:
        raw_type = (col.get("type") or "varchar").strip()
        t = raw_type.lower()
        size = str(col.get("size") or "").strip()
        scale = str(col.get("scale") or "").strip()

        # Sizes for char/varchar/nvarchar/varbinary
        if t in ("varchar", "nvarchar", "char", "nchar", "varbinary", "binary"):
            if size.lower() == "max":
                return f"{t}(max)"
            elif size.isdigit():
                return f"{t}({size})"
            return t

        # Numeric / Decimal
        if t in ("decimal", "numeric"):
            if size.isdigit() and scale.isdigit() and int(scale) > 0:
                return f"{t}({size}, {scale})"
            elif size.isdigit():
                return f"{t}({size})"
            return t

        if t in ("datetime2", "time") and scale.isdigit():
            return f"{t}({scale})"

        # If it's a UDT or custom type, preserve raw casing!
        if "." in raw_type or "[" in raw_type or '"' in raw_type or t not in (
            "bigint", "binary", "bit", "char", "date", "datetime", "datetime2",
            "datetimeoffset", "decimal", "float", "image", "int", "money",
            "nchar", "ntext", "numeric", "nvarchar", "real", "smalldatetime",
            "smallint", "smallmoney", "text", "time", "tinyint", "uniqueidentifier",
            "varbinary", "varchar", "xml", "serial", "bigserial", "smallserial",
            "boolean", "bytea", "double precision", "integer", "json", "jsonb",
            "timestamptz", "timetz", "uuid"
        ):
            return raw_type

        return t

    @classmethod
    def format_default_value(cls, default_val: Any, col_type: str, engine: str) -> str:
        """Formats and sanitizes column default values based on column type and dialect."""
        if default_val is None:
            return ""
        val_str = str(default_val).strip()
        if not val_str:
            return ""

        t = (col_type or "").lower().strip()
        eng = (engine or "sqlserver").lower().strip()

        upper_val = val_str.upper()
        if upper_val == "NULL":
            return "NULL"
        if upper_val.startswith("CURRENT_") or upper_val.startswith("LOCALTIMESTAMP"):
            return val_str

        is_numeric = t in (
            "int", "bigint", "smallint", "tinyint", "decimal", "numeric",
            "float", "real", "money", "smallmoney", "integer", "int2", "int4", "int8"
        )
        if is_numeric:
            cleaned = val_str
            if "::" in cleaned:
                cleaned = cleaned.split("::")[0].strip()
            while (cleaned.startswith("'") and cleaned.endswith("'")) or (cleaned.startswith('"') and cleaned.endswith('"')):
                cleaned = cleaned[1:-1].strip()
            while cleaned.startswith("(") and cleaned.endswith(")"):
                cleaned = cleaned[1:-1].strip()
            return cleaned or "0"

        if val_str.endswith(")") and ("(" in val_str):
            return val_str

        if t in ("boolean", "bool"):
            cleaned = val_str.strip("'\"()").lower()
            if cleaned in ("1", "true", "t"):
                return "true"
            elif cleaned in ("0", "false", "f"):
                return "false"
            return val_str

        if eng == "sqlserver" and t == "bit":
            cleaned = val_str.strip("'\"()").lower()
            if cleaned in ("1", "true", "t"):
                return "((1))"
            elif cleaned in ("0", "false", "f"):
                return "((0))"
            return f"(({val_str}))" if not val_str.startswith("(") else val_str

        is_char = t in ("varchar", "nvarchar", "char", "nchar", "text", "ntext")
        if is_char:
            if (val_str.startswith("'") and val_str.endswith("'")) or (val_str.startswith("N'") and val_str.endswith("'")):
                return val_str
            escaped = val_str.replace("'", "''")
            return f"'{escaped}'"

        return val_str

    @classmethod
    def generate_table_comment_statement(
        cls, schema: str, table: str, comment: Optional[str], engine: str, is_diff: bool = False
    ) -> Optional[str]:
        clean_comment = (comment or "").strip()
        tbl_name = cls._format_table_name(schema, table, engine)
        clean_schema = schema.strip("[]\" ")
        clean_table = table.strip("[]\" ")

        if engine == "sqlserver":
            if clean_comment:
                escaped_val = clean_comment.replace("'", "''")
                if is_diff:
                    return (
                        f"IF NOT EXISTS (SELECT 1 FROM sys.extended_properties "
                        f"WHERE major_id = OBJECT_ID(N'{clean_schema}.{clean_table}') AND minor_id = 0 AND name = N'MS_Description')\n"
                        f"    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'{escaped_val}', "
                        f"@level0type = N'SCHEMA', @level0name = N'{clean_schema}', @level1type = N'TABLE', @level1name = N'{clean_table}';\n"
                        f"ELSE\n"
                        f"    EXEC sys.sp_updateextendedproperty @name = N'MS_Description', @value = N'{escaped_val}', "
                        f"@level0type = N'SCHEMA', @level0name = N'{clean_schema}', @level1type = N'TABLE', @level1name = N'{clean_table}';"
                    )
                else:
                    return (
                        f"EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'{escaped_val}', "
                        f"@level0type = N'SCHEMA', @level0name = N'{clean_schema}', @level1type = N'TABLE', @level1name = N'{clean_table}';"
                    )
            elif is_diff:
                return (
                    f"IF EXISTS (SELECT 1 FROM sys.extended_properties "
                    f"WHERE major_id = OBJECT_ID(N'{clean_schema}.{clean_table}') AND minor_id = 0 AND name = N'MS_Description')\n"
                    f"    EXEC sys.sp_dropextendedproperty @name = N'MS_Description', "
                    f"@level0type = N'SCHEMA', @level0name = N'{clean_schema}', @level1type = N'TABLE', @level1name = N'{clean_table}';"
                )
            return None
        else:
            if clean_comment:
                escaped_val = clean_comment.replace("'", "''")
                return f"COMMENT ON TABLE {tbl_name} IS '{escaped_val}';"
            elif is_diff:
                return f"COMMENT ON TABLE {tbl_name} IS NULL;"
            return None

    @classmethod
    def generate_column_comment_statement(
        cls, schema: str, table: str, col_name: str, comment: Optional[str], engine: str, is_diff: bool = False
    ) -> Optional[str]:
        clean_comment = (comment or "").strip()
        tbl_name = cls._format_table_name(schema, table, engine)
        clean_schema = schema.strip("[]\" ")
        clean_table = table.strip("[]\" ")
        clean_col = col_name.strip("[]\" ")
        q_col = cls._quote_ident(clean_col, engine)

        if engine == "sqlserver":
            if clean_comment:
                escaped_val = clean_comment.replace("'", "''")
                if is_diff:
                    return (
                        f"IF NOT EXISTS (SELECT 1 FROM sys.fn_listextendedproperty(N'MS_Description', N'SCHEMA', N'{clean_schema}', N'TABLE', N'{clean_table}', N'COLUMN', N'{clean_col}'))\n"
                        f"    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'{escaped_val}', "
                        f"@level0type = N'SCHEMA', @level0name = N'{clean_schema}', @level1type = N'TABLE', @level1name = N'{clean_table}', @level2type = N'COLUMN', @level2name = N'{clean_col}';\n"
                        f"ELSE\n"
                        f"    EXEC sys.sp_updateextendedproperty @name = N'MS_Description', @value = N'{escaped_val}', "
                        f"@level0type = N'SCHEMA', @level0name = N'{clean_schema}', @level1type = N'TABLE', @level1name = N'{clean_table}', @level2type = N'COLUMN', @level2name = N'{clean_col}';"
                    )
                else:
                    return (
                        f"EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'{escaped_val}', "
                        f"@level0type = N'SCHEMA', @level0name = N'{clean_schema}', @level1type = N'TABLE', @level1name = N'{clean_table}', @level2type = N'COLUMN', @level2name = N'{clean_col}';"
                    )
            elif is_diff:
                return (
                    f"IF EXISTS (SELECT 1 FROM sys.fn_listextendedproperty(N'MS_Description', N'SCHEMA', N'{clean_schema}', N'TABLE', N'{clean_table}', N'COLUMN', N'{clean_col}'))\n"
                    f"    EXEC sys.sp_dropextendedproperty @name = N'MS_Description', "
                    f"@level0type = N'SCHEMA', @level0name = N'{clean_schema}', @level1type = N'TABLE', @level1name = N'{clean_table}', @level2type = N'COLUMN', @level2name = N'{clean_col}';"
                )
            return None
        else:
            if clean_comment:
                escaped_val = clean_comment.replace("'", "''")
                return f"COMMENT ON COLUMN {tbl_name}.{q_col} IS '{escaped_val}';"
            elif is_diff:
                return f"COMMENT ON COLUMN {tbl_name}.{q_col} IS NULL;"
            return None

    @classmethod
    def generate_column_def(cls, col: Dict[str, Any], engine: str) -> str:
        q_col = cls._quote_ident(col.get("name", ""), engine)

        # Computed / Generated column support
        is_computed = bool(col.get("is_computed") or col.get("computed"))
        formula = (col.get("formula") or col.get("computed_formula") or col.get("definition") or "").strip()
        if is_computed and formula:
            if not (formula.startswith("(") and formula.endswith(")")):
                formula_wrapped = f"({formula})"
            else:
                formula_wrapped = formula
            if engine == "sqlserver":
                persisted = " PERSISTED" if col.get("is_persisted") else ""
                return f"{q_col} AS {formula_wrapped}{persisted}"
            else:
                type_str = cls.format_column_type(col, engine)
                return f"{q_col} {type_str} GENERATED ALWAYS AS {formula_wrapped} STORED"

        type_str = cls.format_column_type(col, engine)
        parts = [q_col, type_str]

        # Base type check for string vs numeric
        base_type = (col.get("type") or "").strip().lower()
        is_char_type = base_type in ("varchar", "nvarchar", "char", "nchar", "text", "ntext")

        # Collation - Only valid for standard character string data types in SQL Server / PostgreSQL
        # COLLATE clause cannot be used on user-defined data types (SQL Server Error 452) or non-string types
        collation = (col.get("collation") or "").strip()
        if collation and collation != "DATABASE_DEFAULT" and collation.lower() != "default" and is_char_type:
            if engine == "sqlserver":
                parts.append(f"COLLATE {collation}")
            else:
                parts.append(f'COLLATE "{collation}"')

        # Sequence or Identity / Auto-increment
        seq_name = (col.get("sequence_name") or "").strip()
        if seq_name:
            if engine == "sqlserver":
                parts.append(f"DEFAULT (NEXT VALUE FOR {seq_name})")
            else:
                parts.append(f"DEFAULT nextval('{seq_name}')")
        elif col.get("is_identity"):
            seed = col.get("identity_seed", 1)
            inc = col.get("identity_increment", 1)
            if engine == "sqlserver":
                parts.append(f"IDENTITY({seed},{inc})")
            elif engine == "postgresql" and type_str not in ("serial", "bigserial", "smallserial"):
                parts.append(f"GENERATED BY DEFAULT AS IDENTITY (START WITH {seed} INCREMENT BY {inc})")

        # Default (if not using sequence)
        raw_default = col.get("default_value")
        if raw_default is not None and str(raw_default).strip() and not seq_name:
            formatted_def = cls.format_default_value(raw_default, col.get("type"), engine)
            if formatted_def:
                parts.append(f"DEFAULT {formatted_def}")

        # Nullability
        if col.get("is_pk") or not col.get("nullable", True):
            parts.append("NOT NULL")
        else:
            parts.append("NULL")

        return " ".join(parts)

    @classmethod
    def generate_create_table_statements(cls, metadata: Dict[str, Any]) -> List[str]:
        engine = metadata.get("engine", "sqlserver")
        schema = metadata.get("schema") or ("public" if engine == "postgresql" else "dbo")
        table = metadata.get("table") or "Untitled"
        tbl_name = cls._format_table_name(schema, table, engine)

        columns = metadata.get("columns", [])
        indexes = metadata.get("indexes", [])
        fks = metadata.get("foreign_keys", [])
        uniques = metadata.get("uniques", [])
        checks = metadata.get("checks", [])
        triggers = metadata.get("triggers", [])

        lines = []
        has_clustered_index = False

        # 1. Column definitions
        for col in columns:
            lines.append("    " + cls.generate_column_def(col, engine))

        # 2. Primary Key
        pk_cols = [col["name"] for col in columns if col.get("is_pk")]
        if pk_cols:
            q_pk_cols = ", ".join(cls._quote_ident(c, engine) for c in pk_cols)
            pk_name = cls._quote_ident(f"PK_{table}", engine)
            if engine == "sqlserver":
                lines.append(f"    CONSTRAINT {pk_name} PRIMARY KEY CLUSTERED ({q_pk_cols})")
                has_clustered_index = True
            else:
                lines.append(f"    CONSTRAINT {pk_name} PRIMARY KEY ({q_pk_cols})")

        # 3. Unique Constraints
        # In SQL Server, cannot add more than one clustered index (SQL Server Error 8112)
        for uq in uniques:
            uq_name = cls._quote_ident(uq.get("name") or f"UQ_{table}", engine)
            uq_cols = ", ".join(cls._quote_ident(c, engine) for c in uq.get("fields", []))
            if uq_cols:
                is_clustered = bool(uq.get("is_clustered")) and not has_clustered_index and (engine == "sqlserver")
                if is_clustered:
                    has_clustered_index = True
                clustered = " CLUSTERED" if is_clustered else ""
                lines.append(f"    CONSTRAINT {uq_name} UNIQUE{clustered} ({uq_cols})")

        # 4. Check Constraints
        for chk in checks:
            chk_name = cls._quote_ident(chk.get("name") or f"CK_{table}", engine)
            clause = chk.get("check_clause", "")
            if clause:
                lines.append(f"    CONSTRAINT {chk_name} CHECK ({clause})")

        # 5. Foreign Key Constraints
        for fk in fks:
            fk_name = cls._quote_ident(fk.get("name") or f"FK_{table}", engine)
            local_cols = ", ".join(cls._quote_ident(c, engine) for c in fk.get("fields", []))
            ref_schema = fk.get("ref_schema") or schema
            ref_tbl = fk.get("ref_table", "")
            ref_cols = ", ".join(cls._quote_ident(c, engine) for c in fk.get("ref_fields", []))
            if local_cols and ref_tbl and ref_cols:
                ref_full = cls._format_table_name(ref_schema, ref_tbl, engine)
                fk_line = f"    CONSTRAINT {fk_name} FOREIGN KEY ({local_cols}) REFERENCES {ref_full} ({ref_cols})"
                on_del = fk.get("on_delete")
                if on_del and on_del.upper() != "NO ACTION":
                    fk_line += f" ON DELETE {on_del.upper()}"
                on_upd = fk.get("on_update")
                if on_upd and on_upd.upper() != "NO ACTION":
                    fk_line += f" ON UPDATE {on_upd.upper()}"
                lines.append(fk_line)

        body = ",\n".join(lines)
        stmts = [f"CREATE TABLE {tbl_name} (\n{body}\n);"]

        # Supplementary Statements: Standalone Indexes
        for idx in indexes:
            idx_name = cls._quote_ident(idx.get("name") or f"IX_{table}", engine)
            fields = idx.get("fields", [])
            if not fields:
                continue
            idx_cols = []
            for f in fields:
                if isinstance(f, dict):
                    col_str = cls._quote_ident(f["column"], engine)
                    if f.get("desc"):
                        col_str += " DESC"
                    idx_cols.append(col_str)
                else:
                    idx_cols.append(cls._quote_ident(str(f), engine))

            unique_str = "UNIQUE " if idx.get("is_unique") else ""
            if engine == "sqlserver":
                raw_itype = (idx.get("index_type") or "NONCLUSTERED").upper()
                if raw_itype == "CLUSTERED":
                    if has_clustered_index:
                        itype = "NONCLUSTERED"
                    else:
                        itype = "CLUSTERED"
                        has_clustered_index = True
                else:
                    itype = raw_itype
                stmts.append(
                    f"CREATE {unique_str}{itype} INDEX {idx_name} ON {tbl_name} ({', '.join(idx_cols)});"
                )
            else:
                itype = idx.get("index_type") or "BTREE"
                stmts.append(
                    f"CREATE {unique_str}INDEX {idx_name} ON {tbl_name} USING {itype.lower()} ({', '.join(idx_cols)});"
                )

        # Supplementary Statements: Triggers
        for tr in triggers:
            t_def = (tr.get("definition") or "").strip()
            if t_def:
                stmts.append(t_def)

        # Supplementary Statements: Table & Column Comments
        tbl_comment = (metadata.get("comment") or metadata.get("description") or "").strip()
        if tbl_comment:
            tbl_comment_stmt = cls.generate_table_comment_statement(schema, table, tbl_comment, engine, is_diff=False)
            if tbl_comment_stmt:
                stmts.append(tbl_comment_stmt)

        for col in columns:
            col_comment = (col.get("comment") or col.get("description") or "").strip()
            if col_comment:
                col_comment_stmt = cls.generate_column_comment_statement(schema, table, col.get("name", ""), col_comment, engine, is_diff=False)
                if col_comment_stmt:
                    stmts.append(col_comment_stmt)

        return stmts

    @classmethod
    def generate_create_table_ddl(cls, metadata: Dict[str, Any]) -> str:
        stmts = cls.generate_create_table_statements(metadata)
        engine = metadata.get("engine", "sqlserver")
        if not stmts:
            return ""
        if engine == "sqlserver":
            return "\n\nGO\n\n".join(stmts) + "\n\nGO\n"
        return "\n\n".join(stmts) + "\n"

    @classmethod
    def is_type_narrowed(cls, ocol: Dict[str, Any], mcol: Dict[str, Any], engine: str) -> bool:
        """Determines if a column data type change represents narrowing (loss of precision/capacity)."""
        otype = (ocol.get("type") or "").strip().lower()
        mtype = (mcol.get("type") or "").strip().lower()
        osize = str(ocol.get("size") or "").strip().lower()
        msize = str(mcol.get("size") or "").strip().lower()
        oscale = str(ocol.get("scale") or "").strip()
        mscale = str(mcol.get("scale") or "").strip()

        # 1. String/binary size narrowing
        string_types = ("varchar", "nvarchar", "char", "nchar", "varbinary", "binary", "text", "ntext")
        if otype in string_types and mtype in string_types:
            if osize == "max" and msize.isdigit():
                return True
            if osize.isdigit() and msize.isdigit() and int(msize) < int(osize):
                return True
            if (otype in ("nvarchar", "nchar") and mtype in ("varchar", "char")) and (osize == msize or (osize.isdigit() and msize.isdigit() and int(msize) <= int(osize))):
                return True
            if otype in ("text", "ntext") and mtype in ("varchar", "nvarchar", "char", "nchar") and msize.isdigit():
                return True

        # 2. Integer hierarchy
        int_hierarchy = {
            "bigint": 4, "int8": 4,
            "int": 3, "integer": 3, "int4": 3,
            "smallint": 2, "int2": 2,
            "tinyint": 1
        }
        if otype in int_hierarchy and mtype in int_hierarchy:
            if int_hierarchy[mtype] < int_hierarchy[otype]:
                return True

        # 3. Decimal/numeric precision/scale narrowing
        if otype in ("decimal", "numeric") and mtype in ("decimal", "numeric"):
            if osize.isdigit() and msize.isdigit() and int(msize) < int(osize):
                return True
            if oscale.isdigit() and mscale.isdigit() and int(mscale) < int(oscale):
                return True

        # 4. Floating point narrowing
        if otype in ("float", "double precision") and mtype in ("real", "float"):
            if mtype == "real" or (msize.isdigit() and int(msize) <= 24 and (not osize.isdigit() or int(osize) > 24)):
                return True

        return False

    @classmethod
    def generate_diff(cls, original: Dict[str, Any], modified: Dict[str, Any]) -> Dict[str, Any]:
        """Calculates differences between original schema and modified schema.
        Returns statements, full migration SQL, and warnings for destructive changes.
        """
        engine = modified.get("engine") or (original and original.get("engine")) or "sqlserver"
        schema = modified.get("schema") or (original and original.get("schema")) or ("public" if engine == "postgresql" else "dbo")
        table = modified.get("table") or (original and original.get("table")) or "Untitled"
        tbl_name = cls._format_table_name(schema, table, engine)
        alt_tbl_name = tbl_name

        statements = []
        warnings = []

        # Check if creating a brand new table
        if not original or not original.get("columns"):
            new_stmts = cls.generate_create_table_statements(modified)
            for s in new_stmts:
                if s.startswith("CREATE TABLE"):
                    category = "tables"
                    desc = "Create table and columns"
                elif " INDEX " in s:
                    category = "indexes"
                    desc = "Create index"
                elif s.startswith("CREATE TRIGGER") or s.startswith("CREATE OR REPLACE TRIGGER"):
                    category = "triggers"
                    desc = "Create trigger"
                elif s.startswith("COMMENT ON") or "sp_addextendedproperty" in s:
                    category = "comments"
                    desc = "Add comment/description"
                elif "FOREIGN KEY" in s:
                    category = "constraints"
                    desc = "Create foreign key"
                else:
                    category = "constraints"
                    desc = "Create constraint"
                statements.append({
                    "sql": s,
                    "destructive": False,
                    "description": desc,
                    "type": category
                })
            join_sep = "\n\nGO\n\n" if engine == "sqlserver" else "\n\n"
            mig_sql = join_sep.join(new_stmts)
            if engine == "sqlserver" and mig_sql.strip():
                mig_sql += "\n\nGO\n"
            elif mig_sql.strip():
                mig_sql += "\n"
            return {
                "statements": statements,
                "migration_sql": mig_sql,
                "has_destructive": False,
                "warnings": []
            }

        orig_cols = {c["name"]: c for c in original.get("columns", [])}
        mod_cols = {c["name"]: c for c in modified.get("columns", [])}

        stmts_rename = []
        stmts_rename_col = []
        stmts_drop_fk = []
        stmts_drop_idx = []
        stmts_drop_uq = []
        stmts_drop_chk = []
        stmts_drop_df = []
        stmts_drop_pk = []
        stmts_drop_col = []
        stmts_add_col = []
        stmts_alter_col = []
        stmts_add_df = []
        stmts_add_pk = []
        stmts_add_uq = []
        stmts_add_chk = []
        stmts_add_fk = []
        stmts_add_idx = []
        stmts_drop_trig = []
        stmts_add_trig = []

        # 0. Table Rename
        orig_tbl_raw = str(original.get("table") or "").strip()
        mod_tbl_raw = str(modified.get("table") or "").strip()
        if orig_tbl_raw and mod_tbl_raw and orig_tbl_raw.lower() != mod_tbl_raw.lower():
            if engine == "sqlserver":
                orig_full = cls._format_table_name(schema, orig_tbl_raw, engine)
                rename_sql = f"EXEC sp_rename @objname = N'{orig_full}', @newname = N'{mod_tbl_raw.strip('[]')}', @objtype = N'OBJECT';"
            else:
                orig_full = cls._format_table_name(schema, orig_tbl_raw, engine)
                q_mod_tbl = cls._quote_ident(mod_tbl_raw, engine)
                rename_sql = f"ALTER TABLE {orig_full} RENAME TO {q_mod_tbl};"
            stmts_rename.append({
                "sql": rename_sql,
                "destructive": False,
                "description": f"Rename table from {orig_tbl_raw} to {mod_tbl_raw}",
                "type": "tables"
            })

        # Track clustered index state in SQL Server (Error 8112 prevention)
        has_clustered = False
        if engine == "sqlserver":
            has_clustered = any(c.get("is_pk") for c in modified.get("columns", []))

        # Foreign Keys Diff (definition comparison)
        orig_fks = {f["name"]: f for f in original.get("foreign_keys", [])}
        mod_fks = {f["name"]: f for f in modified.get("foreign_keys", [])}

        def _fk_signature(fk):
            local_cols = tuple(c.strip('\"[]') for c in fk.get("fields", []))
            rschema = (fk.get("ref_schema") or schema or "").strip('\"[]')
            rtbl = (fk.get("ref_table") or "").strip('\"[]')
            rcols = tuple(c.strip('\"[]') for c in fk.get("ref_fields", []))
            on_del = (fk.get("on_delete") or "NO ACTION").upper()
            on_upd = (fk.get("on_update") or "NO ACTION").upper()
            return (local_cols, rschema, rtbl, rcols, on_del, on_upd)

        for f_name, ofk in orig_fks.items():
            if f_name not in mod_fks or _fk_signature(ofk) != _fk_signature(mod_fks[f_name]):
                q_fk = cls._quote_ident(f_name, engine)
                stmts_drop_fk.append({
                    "sql": f"alter table {alt_tbl_name}\n    drop constraint {q_fk};",
                    "destructive": False,
                    "description": f"Drop foreign key constraint {q_fk}",
                    "type": "constraints"
                })
        for f_name, mfk in mod_fks.items():
            if f_name not in orig_fks or _fk_signature(mfk) != _fk_signature(orig_fks[f_name]):
                q_fk = cls._quote_ident(f_name, engine)
                local_cols = ", ".join(cls._quote_ident(c, engine) for c in mfk.get("fields", []))
                ref_schema = mfk.get("ref_schema") or schema
                ref_tbl = mfk.get("ref_table", "")
                ref_cols = ", ".join(cls._quote_ident(c, engine) for c in mfk.get("ref_fields", []))
                ref_full = cls._format_table_name(ref_schema, ref_tbl, engine)
                fk_sql = f"alter table {alt_tbl_name}\n    add constraint {q_fk} foreign key ({local_cols}) references {ref_full} ({ref_cols})"
                if mfk.get("on_delete") and mfk["on_delete"].upper() != "NO ACTION":
                    fk_sql += f" on delete {mfk['on_delete'].lower()}"
                if mfk.get("on_update") and mfk["on_update"].upper() != "NO ACTION":
                    fk_sql += f" on update {mfk['on_update'].lower()}"
                fk_sql += ";"
                stmts_add_fk.append({
                    "sql": fk_sql,
                    "destructive": False,
                    "description": f"Add foreign key {q_fk}",
                    "type": "constraints"
                })

        # Indexes Diff (definition comparison)
        orig_idxs = {i["name"]: i for i in original.get("indexes", [])}
        mod_idxs = {i["name"]: i for i in modified.get("indexes", [])}

        def _idx_signature(idx):
            cols = []
            for f in idx.get("fields", []):
                if isinstance(f, dict):
                    cols.append((f["column"].strip('\"[]'), bool(f.get("desc"))))
                else:
                    cols.append((str(f).strip('\"[]'), False))
            is_u = bool(idx.get("is_unique"))
            itype = (idx.get("index_type") or ("NONCLUSTERED" if engine == "sqlserver" else "BTREE")).upper()
            return (tuple(cols), is_u, itype)

        for i_name, oidx in orig_idxs.items():
            if i_name not in mod_idxs or _idx_signature(oidx) != _idx_signature(mod_idxs[i_name]):
                q_idx = cls._quote_ident(i_name, engine)
                if engine == "sqlserver":
                    sql = f"DROP INDEX {q_idx} ON {tbl_name};"
                else:
                    sql = f"DROP INDEX {cls._quote_ident(schema, engine)}.{q_idx};"
                stmts_drop_idx.append({
                    "sql": sql,
                    "destructive": False,
                    "description": f"Drop index {q_idx}",
                    "type": "indexes"
                })
        for i_name, midx in mod_idxs.items():
            if i_name not in orig_idxs or _idx_signature(midx) != _idx_signature(orig_idxs[i_name]):
                q_idx = cls._quote_ident(i_name, engine)
                fields = midx.get("fields", [])
                cols = []
                for f in fields:
                    if isinstance(f, dict):
                        col_str = cls._quote_ident(f["column"], engine)
                        if f.get("desc"):
                            col_str += " DESC"
                        cols.append(col_str)
                    else:
                        cols.append(cls._quote_ident(str(f), engine))
                unique_str = "UNIQUE " if midx.get("is_unique") else ""
                if engine == "sqlserver":
                    raw_itype = (midx.get("index_type") or "NONCLUSTERED").upper()
                    if raw_itype == "CLUSTERED":
                        itype = "NONCLUSTERED" if has_clustered else "CLUSTERED"
                        if itype == "CLUSTERED":
                            has_clustered = True
                    else:
                        itype = raw_itype
                    sql = f"CREATE {unique_str}{itype} INDEX {q_idx} ON {tbl_name} ({', '.join(cols)});"
                else:
                    itype = midx.get("index_type") or "BTREE"
                    sql = f"CREATE {unique_str}INDEX {q_idx} ON {tbl_name} USING {itype.lower()} ({', '.join(cols)});"
                stmts_add_idx.append({
                    "sql": sql,
                    "destructive": False,
                    "description": f"Create index {q_idx}",
                    "type": "indexes"
                })

        # Unique Constraints Diff (definition comparison)
        orig_uqs = {u["name"]: u for u in original.get("uniques", [])}
        mod_uqs = {u["name"]: u for u in modified.get("uniques", [])}

        def _uq_signature(uq):
            fields = tuple(c.strip('\"[]') for c in uq.get("fields", []))
            clustered = bool(uq.get("is_clustered")) if engine == "sqlserver" else False
            return (fields, clustered)

        for u_name, ouq in orig_uqs.items():
            if u_name not in mod_uqs or _uq_signature(ouq) != _uq_signature(mod_uqs[u_name]):
                q_uq = cls._quote_ident(u_name, engine)
                stmts_drop_uq.append({
                    "sql": f"alter table {alt_tbl_name}\n    drop constraint {q_uq};",
                    "destructive": False,
                    "description": f"Drop unique constraint {q_uq}",
                    "type": "constraints"
                })
        for u_name, muq in mod_uqs.items():
            if u_name not in orig_uqs or _uq_signature(muq) != _uq_signature(orig_uqs[u_name]):
                q_uq = cls._quote_ident(u_name, engine)
                cols = ", ".join(cls._quote_ident(c, engine) for c in muq.get("fields", []))
                is_clustered = bool(muq.get("is_clustered")) and not has_clustered and (engine == "sqlserver")
                if is_clustered:
                    has_clustered = True
                clustered = " CLUSTERED" if is_clustered else ""
                stmts_add_uq.append({
                    "sql": f"alter table {alt_tbl_name}\n    add constraint {q_uq} unique{clustered} ({cols});",
                    "destructive": False,
                    "description": f"Add unique constraint {q_uq}",
                    "type": "constraints"
                })

        # Check Constraints Diff (definition comparison)
        orig_chks = {c["name"]: c for c in original.get("checks", [])}
        mod_chks = {c["name"]: c for c in modified.get("checks", [])}

        def _chk_signature(chk):
            clause = (chk.get("check_clause") or "").strip()
            while clause.startswith("(") and clause.endswith(")"):
                clause = clause[1:-1].strip()
            return clause

        for c_name, ochk in orig_chks.items():
            if c_name not in mod_chks or _chk_signature(ochk) != _chk_signature(mod_chks[c_name]):
                q_chk = cls._quote_ident(c_name, engine)
                stmts_drop_chk.append({
                    "sql": f"alter table {alt_tbl_name}\n    drop constraint {q_chk};",
                    "destructive": False,
                    "description": f"Drop check constraint {q_chk}",
                    "type": "constraints"
                })
        for c_name, mchk in mod_chks.items():
            if c_name not in orig_chks or _chk_signature(mchk) != _chk_signature(orig_chks[c_name]):
                q_chk = cls._quote_ident(c_name, engine)
                clause = mchk.get("check_clause", "")
                if clause:
                    stmts_add_chk.append({
                        "sql": f"alter table {alt_tbl_name}\n    add constraint {q_chk} check ({clause});",
                        "destructive": False,
                        "description": f"Add check constraint {q_chk}",
                        "type": "constraints"
                    })

        # Primary Key Changes
        orig_pk = [c["name"] for c in original.get("columns", []) if c.get("is_pk")]
        mod_pk = [c["name"] for c in modified.get("columns", []) if c.get("is_pk")]
        if set(orig_pk) != set(mod_pk):
            orig_pk_name = original.get("pk_name")
            if not orig_pk_name:
                for c in original.get("columns", []):
                    if c.get("is_pk") and c.get("pk_name"):
                        orig_pk_name = c["pk_name"]
                        break
            if not orig_pk_name:
                orig_pk_name = f"PK_{table}"
            drop_pk_name = cls._quote_ident(orig_pk_name, engine)

            if orig_pk:
                stmts_drop_pk.append({
                    "sql": f"alter table {alt_tbl_name}\n    drop constraint {drop_pk_name};",
                    "destructive": True,
                    "description": f"Drop primary key {drop_pk_name}",
                    "type": "constraints"
                })
                warnings.append("Primary key constraint will be dropped and recreated.")
            if mod_pk:
                mod_pk_name = modified.get("pk_name")
                if not mod_pk_name:
                    for c in modified.get("columns", []):
                        if c.get("is_pk") and c.get("pk_name"):
                            mod_pk_name = c["pk_name"]
                            break
                if not mod_pk_name:
                    mod_pk_name = orig_pk_name or f"PK_{table}"
                add_pk_name = cls._quote_ident(mod_pk_name, engine)

                q_cols = ", ".join(cls._quote_ident(c, engine) for c in mod_pk)
                clustered = " CLUSTERED" if engine == "sqlserver" else ""
                stmts_add_pk.append({
                    "sql": f"alter table {alt_tbl_name}\n    add constraint {add_pk_name} primary key{clustered} ({q_cols});",
                    "destructive": False,
                    "description": f"Add primary key on ({q_cols})",
                    "type": "constraints"
                })

        # Column Renames (Safe rename without dropping data)
        renamed_cols = {}
        for mcol in modified.get("columns", []):
            orig_col_name = mcol.get("original_name") or mcol.get("orig_name")
            if orig_col_name and orig_col_name in orig_cols and orig_col_name != mcol.get("name"):
                renamed_cols[orig_col_name] = mcol

        for orig_col_name, mcol in renamed_cols.items():
            new_col_name = mcol["name"]
            if engine == "sqlserver":
                orig_col_target = f"{alt_tbl_name}.{cls._quote_ident(orig_col_name, engine)}"
                clean_new_name = new_col_name.strip("[]")
                rename_sql = f"EXEC sp_rename @objname = N'{orig_col_target}', @newname = N'{clean_new_name}', @objtype = N'COLUMN';"
            else:
                q_old = cls._quote_ident(orig_col_name, engine)
                q_new = cls._quote_ident(new_col_name, engine)
                rename_sql = f"alter table {alt_tbl_name}\n    rename column {q_old} to {q_new};"

            stmts_rename_col.append({
                "sql": rename_sql,
                "destructive": False,
                "description": f"Rename column {orig_col_name} to {new_col_name}",
                "type": "tables"
            })
            warnings.append(f"Column {orig_col_name} was renamed to {new_col_name}. References in external queries or routines may need update.")

        # Dropped Columns
        for col_name, ocol in orig_cols.items():
            if col_name not in mod_cols and col_name not in renamed_cols:
                q_col = cls._quote_ident(col_name, engine)
                if engine == "sqlserver" and (ocol.get("default_constraint_name") or ocol.get("default_value")):
                    old_df = ocol.get("default_constraint_name") or f"DF_{table}_{col_name}"
                    q_old_df = cls._quote_ident(old_df, engine)
                    stmts_drop_df.append({
                        "sql": f"alter table {alt_tbl_name}\n    drop constraint {q_old_df};",
                        "destructive": False,
                        "description": f"Drop default constraint {old_df} before dropping column",
                        "type": "constraints"
                    })
                sql = f"alter table {alt_tbl_name}\n    drop column {q_col};"
                stmts_drop_col.append({
                    "sql": sql,
                    "destructive": True,
                    "description": f"Drop column {col_name}",
                    "type": "tables"
                })
                warnings.append(f"Column {col_name} will be dropped and its data permanently deleted.")

        # Added Columns
        for col_name, mcol in mod_cols.items():
            orig_name = mcol.get("original_name") or mcol.get("orig_name")
            if col_name not in orig_cols and (not orig_name or orig_name not in orig_cols):
                q_col = cls._quote_ident(col_name, engine)
                type_str = cls.format_column_type(mcol, engine).lower()
                
                parts = [f"    add {q_col} {type_str}"]
                raw_default = mcol.get("default_value")
                default_val = cls.format_default_value(raw_default, mcol.get("type"), engine) if raw_default is not None and str(raw_default).strip() else ""
                if default_val:
                    parts.append(f"default {default_val}")
                if mcol.get("is_pk") or not mcol.get("nullable", True):
                    parts.append("not null")

                is_not_null_no_def = (not mcol.get("nullable", True) and not mcol.get("is_pk") and not default_val and not mcol.get("is_identity"))
                if is_not_null_no_def:
                    warnings.append(f"Adding NOT NULL column {col_name} without default value may fail on non-empty tables.")

                sql = f"alter table {alt_tbl_name}\n{' '.join(parts)};"
                stmts_add_col.append({
                    "sql": sql,
                    "destructive": is_not_null_no_def,
                    "description": f"Add column {col_name}",
                    "type": "tables"
                })

        # Modified Columns
        for col_name, mcol in mod_cols.items():
            orig_name = mcol.get("original_name") or mcol.get("orig_name")
            ocol = None
            if col_name in orig_cols:
                ocol = orig_cols[col_name]
            elif orig_name and orig_name in orig_cols:
                ocol = orig_cols[orig_name]

            if ocol:
                ocol_null = ocol.get("nullable", True)
                mcol_null = mcol.get("nullable", True)
                type_changed = (mcol.get("type") != ocol.get("type")) or (str(mcol.get("size")) != str(ocol.get("size"))) or (str(mcol.get("scale")) != str(ocol.get("scale")))
                null_changed = (bool(mcol_null) != bool(ocol_null))
                def_changed = (str(mcol.get("default_value") or "").strip() != str(ocol.get("default_value") or "").strip())

                is_narrowed = cls.is_type_narrowed(ocol, mcol, engine)
                if is_narrowed:
                    warnings.append(f"Column {col_name} data type narrowed from {cls.format_column_type(ocol, engine)} to {cls.format_column_type(mcol, engine)}; data truncation may occur.")
                if null_changed and not mcol_null:
                    warnings.append(f"Column {col_name} changed to NOT NULL; existing NULL rows will cause migration failure.")

                q_col = cls._quote_ident(col_name, engine)
                if type_changed or null_changed:
                    if engine == "sqlserver":
                        type_str = cls.format_column_type(mcol, engine).lower()
                        null_str = "null" if mcol_null else "not null"
                        sql = f"alter table {alt_tbl_name}\n    alter column {q_col} {type_str} {null_str};"
                        stmts_alter_col.append({
                            "sql": sql,
                            "destructive": is_narrowed,
                            "description": f"Alter column {col_name} type/nullability",
                            "type": "tables"
                        })
                    else:
                        type_str = cls.format_column_type(mcol, engine).lower()
                        if type_changed:
                            pg_type_map = {
                                "serial": "integer",
                                "bigserial": "bigint",
                                "smallserial": "smallint",
                                "serial4": "integer",
                                "serial8": "bigint",
                                "serial2": "smallint"
                            }
                            norm_target_type = pg_type_map.get(type_str, type_str)
                            sql = f"alter table {alt_tbl_name}\n    alter column {q_col} type {norm_target_type} using {q_col}::{norm_target_type};"
                            stmts_alter_col.append({
                                "sql": sql,
                                "destructive": is_narrowed,
                                "description": f"Alter column {col_name} data type to {norm_target_type}",
                                "type": "tables"
                            })
                        if null_changed:
                            null_action = "drop not null" if mcol_null else "set not null"
                            sql = f"alter table {alt_tbl_name}\n    alter column {q_col} {null_action};"
                            stmts_alter_col.append({
                                "sql": sql,
                                "destructive": False,
                                "description": f"Alter column {col_name} nullability",
                                "type": "tables"
                            })

                if def_changed:
                    raw_new_def = mcol.get("default_value")
                    new_def = cls.format_default_value(raw_new_def, mcol.get("type"), engine) if raw_new_def is not None and str(raw_new_def).strip() else ""

                    if engine == "sqlserver":
                        old_df = ocol.get("default_constraint_name") or (f"DF_{table}_{ocol.get('name', col_name)}" if ocol.get("default_value") else "")
                        if old_df:
                            q_old_df = cls._quote_ident(old_df, engine)
                            stmts_drop_df.append({
                                "sql": f"alter table {alt_tbl_name}\n    drop constraint {q_old_df};",
                                "destructive": False,
                                "description": f"Drop default constraint {old_df} for {col_name}",
                                "type": "constraints"
                            })
                        if new_def:
                            new_df_name = mcol.get("default_constraint_name") or f"DF_{table}_{col_name}"
                            df_name = cls._quote_ident(new_df_name, engine)
                            stmts_add_df.append({
                                "sql": f"alter table {alt_tbl_name}\n    add constraint {df_name} default {new_def} for {q_col};",
                                "destructive": False,
                                "description": f"Set default value for {col_name}",
                                "type": "constraints"
                            })
                    else:
                        if new_def:
                            sql = f"alter table {alt_tbl_name}\n    alter column {q_col} set default {new_def};"
                        else:
                            sql = f"alter table {alt_tbl_name}\n    alter column {q_col} drop default;"
                        stmts_alter_col.append({
                            "sql": sql,
                            "destructive": False,
                            "description": f"Change default value for {col_name}",
                            "type": "tables"
                        })

        # Triggers Diff
        orig_trigs = {t["name"]: t for t in original.get("triggers", [])}
        mod_trigs = {t["name"]: t for t in modified.get("triggers", [])}
        for t_name in orig_trigs:
            if t_name not in mod_trigs:
                q_tr = cls._quote_ident(t_name, engine)
                if engine == "sqlserver":
                    sql = f"DROP TRIGGER {cls._quote_ident(schema, engine)}.{q_tr};"
                else:
                    sql = f"DROP TRIGGER {q_tr} ON {tbl_name};"
                stmts_drop_trig.append({
                    "sql": sql,
                    "destructive": True,
                    "description": f"Drop trigger {q_tr}",
                    "type": "triggers"
                })
        for t_name, tr in mod_trigs.items():
            if t_name not in orig_trigs or (tr.get("definition") or "").strip() != (orig_trigs[t_name].get("definition") or "").strip():
                t_def = (tr.get("definition") or "").strip()
                if t_def:
                    stmts_add_trig.append({
                        "sql": t_def,
                        "destructive": False,
                        "description": f"Deploy trigger {t_name}",
                        "type": "triggers"
                    })

        # Table & Column Comments Diff
        stmts_comment = []
        orig_tbl_cmt = (original.get("comment") or original.get("description") or "").strip()
        mod_tbl_cmt = (modified.get("comment") or modified.get("description") or "").strip()
        if orig_tbl_cmt != mod_tbl_cmt:
            t_cmt_sql = cls.generate_table_comment_statement(schema, table, mod_tbl_cmt, engine, is_diff=True)
            if t_cmt_sql:
                stmts_comment.append({
                    "sql": t_cmt_sql,
                    "destructive": False,
                    "description": f"Update description for table {table}",
                    "type": "comments"
                })

        for col_name, mcol in mod_cols.items():
            orig_name = mcol.get("original_name") or mcol.get("orig_name")
            ocol = None
            if col_name in orig_cols:
                ocol = orig_cols[col_name]
            elif orig_name and orig_name in orig_cols:
                ocol = orig_cols[orig_name]

            orig_col_cmt = (ocol.get("comment") or ocol.get("description") or "").strip() if ocol else ""
            mod_col_cmt = (mcol.get("comment") or mcol.get("description") or "").strip()
            if orig_col_cmt != mod_col_cmt:
                c_cmt_sql = cls.generate_column_comment_statement(schema, table, col_name, mod_col_cmt, engine, is_diff=True)
                if c_cmt_sql:
                    stmts_comment.append({
                        "sql": c_cmt_sql,
                        "destructive": False,
                        "description": f"Update description for column {col_name}",
                        "type": "comments"
                    })

        # Assemble statements in dependency-safe order:
        # 1. Rename table
        # 2. Drops: FK -> Index -> Unique -> Check -> Default -> PK
        # 3. Rename columns
        # 4. Drop columns
        # 5. Add columns
        # 6. Alter columns
        # 7. Add defaults
        # 8. Add constraints: PK -> Unique -> Check -> FK
        # 9. Add indexes
        # 10. Table & Column Comments
        # 11. Triggers: Drop -> Add
        statements = (
            stmts_rename +
            stmts_drop_fk +
            stmts_drop_idx +
            stmts_drop_uq +
            stmts_drop_chk +
            stmts_drop_df +
            stmts_drop_pk +
            stmts_rename_col +
            stmts_drop_col +
            stmts_add_col +
            stmts_alter_col +
            stmts_add_df +
            stmts_add_pk +
            stmts_add_uq +
            stmts_add_chk +
            stmts_add_fk +
            stmts_add_idx +
            stmts_comment +
            stmts_drop_trig +
            stmts_add_trig
        )

        # Build unified migration SQL string
        if not statements:
            migration_sql = ""
        elif engine == "sqlserver":
            migration_sql = "\n\nGO\n\n".join(s["sql"] for s in statements) + "\n\nGO\n"
        else:
            migration_sql = "\n\n".join(s["sql"] for s in statements) + "\n"

        return {
            "statements": statements,
            "migration_sql": migration_sql,
            "has_changes": bool(statements),
            "warnings": warnings,
            "has_destructive": any(s["destructive"] for s in statements)
        }
