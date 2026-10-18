import { applyDecorators, Body, Injectable, type PipeTransform, Query } from '@nestjs/common';
import { ApiBody, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { z } from 'zod';
import { AppException } from './app-exception';

/** Validates and transforms input with a shared contract schema. */
@Injectable()
export class ZodValidationPipe<S extends z.ZodType> implements PipeTransform<unknown, z.output<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.output<S> {
    const result = this.schema.safeParse(value ?? {});
    if (result.success) return result.data;
    throw AppException.validation(
      result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    );
  }
}

/** `@ZodBody(schema) body: T` — validated request body. */
export const ZodBody = (schema: z.ZodType) => Body(new ZodValidationPipe(schema));

/** `@ZodQuery(schema) query: T` — validated query string. */
export const ZodQuery = (schema: z.ZodType) => Query(new ZodValidationPipe(schema));

type OpenApiSchema = Record<string, unknown>;

export function toOpenApiSchema(schema: z.ZodType, io: 'input' | 'output'): OpenApiSchema {
  const json = z.toJSONSchema(schema, {
    target: 'openapi-3.0',
    io,
    unrepresentable: 'any',
  }) as OpenApiSchema;
  delete json.$schema;
  return json;
}

/** Documents a request body from a Zod schema. */
export const ApiZodBody = (schema: z.ZodType) =>
  ApiBody({ schema: toOpenApiSchema(schema, 'input') as never });

/** Documents a response from a Zod schema. */
export const ApiZodResponse = (status: number, schema: z.ZodType, description?: string) =>
  ApiResponse({ status, description, schema: toOpenApiSchema(schema, 'output') as never });

/** Documents each query parameter of an object schema. */
export function ApiZodQuery(schema: z.ZodObject) {
  return applyDecorators(
    ...Object.entries(schema.shape).map(([name, field]) =>
      ApiQuery({
        name,
        required: !(field as z.ZodType).safeParse(undefined).success,
        schema: toOpenApiSchema(field as z.ZodType, 'input') as never,
      }),
    ),
  );
}
